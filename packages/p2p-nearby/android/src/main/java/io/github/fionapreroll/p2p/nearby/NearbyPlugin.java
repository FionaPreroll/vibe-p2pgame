package io.github.fionapreroll.p2p.nearby;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.text.TextUtils;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.nearby.Nearby;
import com.google.android.gms.nearby.connection.AdvertisingOptions;
import com.google.android.gms.nearby.connection.ConnectionInfo;
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback;
import com.google.android.gms.nearby.connection.ConnectionOptions;
import com.google.android.gms.nearby.connection.ConnectionResolution;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes;
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import java.util.HashSet;
import java.util.Set;

/**
 * The native side of @fionapreroll/p2p-nearby (src/index.ts), through Google's Nearby Connections:
 * the host advertises, players discover it, and a star of connections carries the game's messages,
 * each tagged with its channel.
 * Nearby finds phones over Bluetooth Low Energy and connects them over Bluetooth, and moves to a
 * faster Wi-Fi link between them where it can without disturbing the phone's own Wi-Fi.
 *
 * Nobody nearby is trusted: only this game's service is looked for, connections need the host's
 * yes after comparing a code, few requests may wait at once, and messages are taken only from
 * accepted connections, only as bytes, small, on a known channel, and not too many a second.
 */
@CapacitorPlugin(
    name = "Nearby",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
            }
        ),
        @Permission(alias = "wifi", strings = { Manifest.permission.NEARBY_WIFI_DEVICES }),
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION }),
        @Permission(alias = "coarse", strings = { Manifest.permission.ACCESS_COARSE_LOCATION }),
    }
)
public class NearbyPlugin extends Plugin {

    /** Both sides look for the game's own service only, which the game names when it starts. */
    private String serviceId = null;

    /** Every permission Nearby may need on some Android version, for the debug report. */
    private static final String[] PERMISSIONS = {
        "android.permission.BLUETOOTH",
        "android.permission.BLUETOOTH_ADMIN",
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_ADVERTISE",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.NEARBY_WIFI_DEVICES",
        "android.permission.ACCESS_WIFI_STATE",
        "android.permission.CHANGE_WIFI_STATE",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_FINE_LOCATION",
    };

    private ConnectionsClient client;
    private boolean advertising = false;
    private boolean discovering = false;
    private final NearbyRules.DebugLog log = new NearbyRules.DebugLog(System.currentTimeMillis(), NearbyRules.MAX_LOG_LINES);
    private final Set<String> pending = new HashSet<>();
    private final Set<String> connected = new HashSet<>();
    private final NearbyRules.FastLanes lanes = new NearbyRules.FastLanes(NearbyRules.MAX_FAST_IN_FLIGHT);
    private final NearbyRules.RateLimit rates = new NearbyRules.RateLimit(NearbyRules.MAX_MESSAGES_PER_SECOND);

    @Override
    public void load() {
        client = Nearby.getConnectionsClient(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        stopEverything();
    }

    /** Starts as the host (advertising) or as a player (discovering), after asking for permissions. */
    @PluginMethod
    public void start(PluginCall call) {
        String role = call.getString("role", "");
        log("start " + role + " (Android " + Build.VERSION.SDK_INT + ")");
        String service = call.getString("service", "");
        if ((!"host".equals(role) && !"player".equals(role)) || shorten(call.getString("name", "")).isEmpty()
                || !NearbyRules.isService(service)) {
            call.reject("Bad arguments");
            return;
        }
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) != ConnectionResult.SUCCESS) {
            int status = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext());
            String text = GoogleApiAvailability.getInstance().getErrorString(status);
            log("Google Play services not available: " + status + " " + text);
            call.reject("Google Play services not available: " + text + " (" + status + ")", "unavailable");
            return;
        }
        String[] aliases = askedAliases(role);
        for (String alias : requiredAliases(role)) {
            if (getPermissionState(alias) != PermissionState.GRANTED) {
                log("asking for permissions: " + TextUtils.join(", ", aliases));
                requestPermissionForAliases(aliases, call, "permissionsAnswered");
                return;
            }
        }
        begin(call);
    }

    @PermissionCallback
    private void permissionsAnswered(PluginCall call) {
        for (String alias : requiredAliases(call.getString("role", ""))) {
            if (getPermissionState(alias) != PermissionState.GRANTED) {
                log("permission " + alias + " not granted: " + getPermissionState(alias));
                call.reject("Permission " + alias + " not granted", "permission");
                return;
            }
        }
        log("permissions granted");
        begin(call);
    }

    private void begin(PluginCall call) {
        String name = shorten(call.getString("name", ""));
        serviceId = call.getString("service", "");
        String role = call.getString("role", "");
        // Nearby's own errors say little when the radio is off: this is checked first.
        if (Boolean.FALSE.equals(bluetoothEnabled())) {
            log("Bluetooth is off");
            call.reject("Bluetooth is off", "bluetooth-off");
            return;
        }
        if ("host".equals(role)) {
            client.stopDiscovery();
            client.stopAdvertising();
            AdvertisingOptions options = new AdvertisingOptions.Builder().setStrategy(Strategy.P2P_STAR).build();
            client
                .startAdvertising(name, serviceId, lifecycle, options)
                .addOnSuccessListener(unused -> {
                    advertising = true;
                    log("advertising");
                    call.resolve();
                })
                .addOnFailureListener(e -> failed(call, "advertise", e));
        } else {
            client.stopAdvertising();
            advertising = false;
            client.stopDiscovery();
            discovering = false;
            DiscoveryOptions options = new DiscoveryOptions.Builder().setStrategy(Strategy.P2P_STAR).build();
            client
                .startDiscovery(serviceId, discovery, options)
                .addOnSuccessListener(unused -> {
                    discovering = true;
                    log("discovering");
                    call.resolve();
                })
                .addOnFailureListener(e -> failed(call, "discover", e));
        }
    }

    /** Stops advertising and discovering; connections stay. */
    @PluginMethod
    public void stop(PluginCall call) {
        client.stopAdvertising();
        client.stopDiscovery();
        if (advertising || discovering) log("stopped advertising and discovering");
        advertising = false;
        discovering = false;
        call.resolve();
    }

    /** A player asks a host found nearby to connect. */
    @PluginMethod
    public void connect(PluginCall call) {
        String endpointId = call.getString("endpointId", "");
        String name = shorten(call.getString("name", ""));
        if (endpointId.isEmpty() || name.isEmpty()) {
            call.reject("Bad arguments");
            return;
        }
        // Not disruptive: Nearby must not take the phone off its Wi-Fi for a faster link.
        ConnectionOptions options = new ConnectionOptions.Builder().setDisruptiveUpgrade(false).build();
        log("asking " + endpointId + " to connect");
        client
            .requestConnection(name, endpointId, lifecycle, options)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(e -> failed(call, "connect to " + endpointId, e));
    }

    /** Says yes to a waiting connection, once the codes on both phones match. */
    @PluginMethod
    public void accept(PluginCall call) {
        String endpointId = call.getString("endpointId", "");
        if (!pending.contains(endpointId)) {
            call.reject("No such request");
            return;
        }
        log("accepting " + endpointId);
        client
            .acceptConnection(endpointId, payloads)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(e -> failed(call, "accept " + endpointId, e));
    }

    @PluginMethod
    public void reject(PluginCall call) {
        String endpointId = call.getString("endpointId", "");
        if (pending.remove(endpointId)) {
            log("rejecting " + endpointId);
            client.rejectConnection(endpointId);
        }
        call.resolve();
    }

    /** Sends a message on a channel; a fast one is dropped while the link is still busy. */
    @PluginMethod
    public void send(PluginCall call) {
        String endpointId = call.getString("endpointId", "");
        String channel = call.getString("channel", "");
        String data = call.getString("data", "");
        if (!connected.contains(endpointId)) {
            call.reject("Not connected");
            return;
        }
        boolean fast = "fast".equals(channel);
        if (!fast && !"control".equals(channel)) {
            call.reject("No such channel");
            return;
        }
        byte[] bytes = NearbyRules.encode(channel, data);
        if (bytes == null) {
            call.reject("Too long");
            return;
        }
        if (fast && !lanes.free(endpointId)) {
            call.resolve();
            return;
        }
        Payload payload = Payload.fromBytes(bytes);
        if (fast) lanes.sent(endpointId, payload.getId());
        client.sendPayload(endpointId, payload).addOnFailureListener(e -> lanes.released(payload.getId()));
        call.resolve();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        String endpointId = call.getString("endpointId", "");
        if (pending.remove(endpointId)) client.rejectConnection(endpointId);
        if (connected.contains(endpointId)) {
            client.disconnectFromEndpoint(endpointId);
            gone(endpointId);
        }
        call.resolve();
    }

    /** Ends everything: advertising, discovering and every connection, as after a reload of the page. */
    @PluginMethod
    public void reset(PluginCall call) {
        stopEverything();
        call.resolve();
    }

    private void stopEverything() {
        if (client == null) return;
        client.stopAdvertising();
        client.stopDiscovery();
        client.stopAllEndpoints();
        log("reset");
        advertising = false;
        discovering = false;
        pending.clear();
        connected.clear();
        lanes.clear();
        rates.clear();
    }

    private final ConnectionLifecycleCallback lifecycle = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(String endpointId, ConnectionInfo info) {
            // A host takes requests only while it advertises, and only a few at once.
            if (NearbyRules.turnDown(info.isIncomingConnection(), advertising, pending.size())) {
                log("turned down request from " + endpointId + (advertising ? ": too many waiting" : ": not hosting"));
                client.rejectConnection(endpointId);
                return;
            }
            log((info.isIncomingConnection() ? "request from " : "answer from ") + endpointId);
            pending.add(endpointId);
            JSObject request = new JSObject();
            request.put("endpointId", endpointId);
            request.put("name", shorten(info.getEndpointName()));
            request.put("digits", info.getAuthenticationDigits());
            request.put("incoming", info.isIncomingConnection());
            notifyListeners("request", request);
        }

        @Override
        public void onConnectionResult(String endpointId, ConnectionResolution result) {
            pending.remove(endpointId);
            JSObject event = new JSObject();
            event.put("endpointId", endpointId);
            if (result.getStatus().isSuccess()) {
                connected.add(endpointId);
                log("connected to " + endpointId);
                notifyListeners("connected", event);
            } else {
                log("no connection to " + endpointId + ": " + describe(result.getStatus().getStatusCode()));
                event.put("status", result.getStatus().getStatusCode());
                notifyListeners("rejected", event);
            }
        }

        @Override
        public void onDisconnected(String endpointId) {
            log("disconnected from " + endpointId);
            if (connected.contains(endpointId)) gone(endpointId);
        }
    };

    private final EndpointDiscoveryCallback discovery = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(String endpointId, DiscoveredEndpointInfo info) {
            if (serviceId == null || !serviceId.equals(info.getServiceId())) return;
            log("found " + endpointId);
            JSObject found = new JSObject();
            found.put("endpointId", endpointId);
            found.put("name", shorten(info.getEndpointName()));
            notifyListeners("found", found);
        }

        @Override
        public void onEndpointLost(String endpointId) {
            log("lost " + endpointId);
            JSObject lost = new JSObject();
            lost.put("endpointId", endpointId);
            notifyListeners("lost", lost);
        }
    };

    private final PayloadCallback payloads = new PayloadCallback() {
        @Override
        public void onPayloadReceived(String endpointId, Payload payload) {
            if (!connected.contains(endpointId)) return;
            if (payload.getType() != Payload.Type.BYTES) {
                // Files and streams are not part of the game: none is taken.
                client.cancelPayload(payload.getId());
                return;
            }
            String[] decoded = NearbyRules.decode(payload.asBytes());
            if (decoded == null || !rates.allow(endpointId, System.currentTimeMillis())) return;
            JSObject message = new JSObject();
            message.put("endpointId", endpointId);
            message.put("channel", decoded[0]);
            message.put("data", decoded[1]);
            notifyListeners("message", message);
        }

        @Override
        public void onPayloadTransferUpdate(String endpointId, PayloadTransferUpdate update) {
            int status = update.getStatus();
            if (status != PayloadTransferUpdate.Status.IN_PROGRESS) lanes.released(update.getPayloadId());
        }
    };

    private void gone(String endpointId) {
        connected.remove(endpointId);
        lanes.forget(endpointId);
        rates.forget(endpointId);
        JSObject event = new JSObject();
        event.put("endpointId", endpointId);
        notifyListeners("disconnected", event);
    }

    /**
     * What the debug report says about Bluetooth on this phone: the phone, Google Play services,
     * the radio, Location, every permission Nearby may need, Nearby's state and the log.
     */
    @PluginMethod
    public void diagnostics(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("android", Build.VERSION.RELEASE);
        result.put("sdk", Build.VERSION.SDK_INT);
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("model", Build.MODEL);
        int services = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context);
        result.put("playServices", services + " " + GoogleApiAvailability.getInstance().getErrorString(services));
        try {
            PackageInfo gms = context.getPackageManager().getPackageInfo("com.google.android.gms", 0);
            result.put("playServicesVersion", gms.versionName);
        } catch (Exception e) {
            result.put("playServicesVersion", "missing");
        }
        Boolean bluetooth = bluetoothEnabled();
        result.put("bluetooth", bluetooth == null ? "unknown" : bluetooth ? "on" : "off");
        Boolean location = locationEnabled();
        result.put("location", location == null ? "unknown" : location ? "on" : "off");
        JSObject permissions = new JSObject();
        for (String permission : PERMISSIONS) {
            permissions.put(
                permission.substring(permission.lastIndexOf('.') + 1),
                ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED ? "granted" : "denied"
            );
        }
        result.put("permissions", permissions);
        result.put(
            "neededPermissions",
            "host " + TextUtils.join(", ", askedAliases("host")) + "; player " + TextUtils.join(", ", askedAliases("player"))
        );
        result.put("advertising", advertising);
        result.put("discovering", discovering);
        result.put("waiting", pending.size());
        result.put("connected", connected.size());
        JSArray lines = new JSArray();
        for (String line : log.lines()) lines.put(line);
        result.put("log", lines);
        call.resolve(result);
    }

    /** A step that failed: logged with Nearby's own name for the status, and handed back. */
    private void failed(PluginCall call, String step, Exception e) {
        String what = e instanceof ApiException ? describe(((ApiException) e).getStatusCode()) : String.valueOf(e.getMessage());
        Boolean location = locationEnabled();
        log("could not " + step + ": " + what + (Boolean.FALSE.equals(location) ? " (Location is off)" : ""));
        // A permission Nearby misses is the player's to give; Location off is the likely cause of
        // a failed discovery otherwise.
        Integer status = e instanceof ApiException ? ((ApiException) e).getStatusCode() : null;
        String name = status == null ? null : ConnectionsStatusCodes.getStatusCodeString(status);
        call.reject("Could not " + step + ": " + what, NearbyRules.failureCode(status, name, location, step), e);
    }

    private static String describe(int status) {
        return status + " " + ConnectionsStatusCodes.getStatusCodeString(status);
    }

    private void log(String line) {
        log.add(line, System.currentTimeMillis());
    }

    /** Whether Bluetooth is switched on; null where the phone does not say. */
    private Boolean bluetoothEnabled() {
        try {
            BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
            BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
            return adapter == null ? Boolean.FALSE : adapter.isEnabled();
        } catch (SecurityException e) {
            return null;
        }
    }

    /** Whether Location is switched on; null where the phone does not say. */
    private Boolean locationEnabled() {
        try {
            LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (manager == null) return null;
            if (Build.VERSION.SDK_INT >= 28) return manager.isLocationEnabled();
            return manager.isProviderEnabled(LocationManager.GPS_PROVIDER) || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) {
            return null;
        }
    }

    private static String[] askedAliases(String role) {
        return NearbyRules.askedAliases(role, Build.VERSION.SDK_INT).toArray(new String[0]);
    }

    private static String[] requiredAliases(String role) {
        return NearbyRules.requiredAliases(role, Build.VERSION.SDK_INT).toArray(new String[0]);
    }

    private static String shorten(String text) {
        return NearbyRules.shorten(text);
    }
}
