package io.github.fionapreroll.sparkhunt;

import android.Manifest;
import android.os.Build;
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
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo;
import com.google.android.gms.nearby.connection.DiscoveryOptions;
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback;
import com.google.android.gms.nearby.connection.Payload;
import com.google.android.gms.nearby.connection.PayloadCallback;
import com.google.android.gms.nearby.connection.PayloadTransferUpdate;
import com.google.android.gms.nearby.connection.Strategy;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Bluetooth for src/bluetooth.ts, through Google's Nearby Connections: the host advertises, players
 * discover it, and a star of connections carries the game's messages, each tagged with its channel.
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

    /** Both sides look for this service only: other apps' Nearby traffic never reaches the game. */
    private static final String SERVICE_ID = "io.github.fionapreroll.sparkhunt.game";
    private static final int MAX_NAME_LENGTH = 64;
    /** Connection requests waiting for the host's answer at once; more are turned down. */
    private static final int MAX_PENDING = 4;
    /** Messages a second taken from one connection; more are dropped before they reach the game. */
    private static final int MAX_MESSAGES_PER_SECOND = 120;
    /** Fast messages on their way to one connection; while there are this many, new ones are dropped. */
    private static final int MAX_FAST_IN_FLIGHT = 2;

    private ConnectionsClient client;
    private boolean advertising = false;
    private final Set<String> pending = new HashSet<>();
    private final Set<String> connected = new HashSet<>();
    private final Map<String, Integer> fastInFlight = new HashMap<>();
    private final Map<Long, String> fastPayloads = new HashMap<>();
    private final Map<String, long[]> rates = new HashMap<>();

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
        if ((!"host".equals(role) && !"player".equals(role)) || shorten(call.getString("name", "")).isEmpty()) {
            call.reject("Bad arguments");
            return;
        }
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(getContext()) != ConnectionResult.SUCCESS) {
            call.reject("Google Play services are missing", "unavailable");
            return;
        }
        String[] aliases = neededAliases();
        for (String alias : aliases) {
            if (getPermissionState(alias) != PermissionState.GRANTED) {
                requestPermissionForAliases(aliases, call, "permissionsAnswered");
                return;
            }
        }
        begin(call);
    }

    @PermissionCallback
    private void permissionsAnswered(PluginCall call) {
        for (String alias : neededAliases()) {
            if (getPermissionState(alias) != PermissionState.GRANTED) {
                call.reject("Permission denied", "permission");
                return;
            }
        }
        begin(call);
    }

    private void begin(PluginCall call) {
        String name = shorten(call.getString("name", ""));
        if ("host".equals(call.getString("role", ""))) {
            client.stopDiscovery();
            client.stopAdvertising();
            AdvertisingOptions options = new AdvertisingOptions.Builder().setStrategy(Strategy.P2P_STAR).build();
            client
                .startAdvertising(name, SERVICE_ID, lifecycle, options)
                .addOnSuccessListener(unused -> {
                    advertising = true;
                    call.resolve();
                })
                .addOnFailureListener(e -> call.reject("Could not advertise", code(e), e));
        } else {
            client.stopAdvertising();
            advertising = false;
            client.stopDiscovery();
            DiscoveryOptions options = new DiscoveryOptions.Builder().setStrategy(Strategy.P2P_STAR).build();
            client
                .startDiscovery(SERVICE_ID, discovery, options)
                .addOnSuccessListener(unused -> call.resolve())
                .addOnFailureListener(e -> call.reject("Could not discover", code(e), e));
        }
    }

    /** Stops advertising and discovering; connections stay. */
    @PluginMethod
    public void stop(PluginCall call) {
        client.stopAdvertising();
        client.stopDiscovery();
        advertising = false;
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
        client
            .requestConnection(name, endpointId, lifecycle, options)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(e -> call.reject("Could not connect", code(e), e));
    }

    /** Says yes to a waiting connection, once the codes on both phones match. */
    @PluginMethod
    public void accept(PluginCall call) {
        String endpointId = call.getString("endpointId", "");
        if (!pending.contains(endpointId)) {
            call.reject("No such request");
            return;
        }
        client
            .acceptConnection(endpointId, payloads)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(e -> call.reject("Could not accept", code(e), e));
    }

    @PluginMethod
    public void reject(PluginCall call) {
        String endpointId = call.getString("endpointId", "");
        if (pending.remove(endpointId)) client.rejectConnection(endpointId);
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
        byte[] bytes = ((fast ? "f" : "c") + data).getBytes(StandardCharsets.UTF_8);
        if (bytes.length > ConnectionsClient.MAX_BYTES_DATA_SIZE) {
            call.reject("Too long");
            return;
        }
        int inFlight = fastInFlight.containsKey(endpointId) ? fastInFlight.get(endpointId) : 0;
        if (fast && inFlight >= MAX_FAST_IN_FLIGHT) {
            call.resolve();
            return;
        }
        Payload payload = Payload.fromBytes(bytes);
        if (fast) {
            fastPayloads.put(payload.getId(), endpointId);
            fastInFlight.put(endpointId, inFlight + 1);
        }
        client.sendPayload(endpointId, payload).addOnFailureListener(e -> released(payload.getId()));
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
        advertising = false;
        pending.clear();
        connected.clear();
        fastInFlight.clear();
        fastPayloads.clear();
        rates.clear();
    }

    private final ConnectionLifecycleCallback lifecycle = new ConnectionLifecycleCallback() {
        @Override
        public void onConnectionInitiated(String endpointId, ConnectionInfo info) {
            // A host takes requests only while it advertises, and only a few at once.
            if (info.isIncomingConnection() && (!advertising || pending.size() >= MAX_PENDING)) {
                client.rejectConnection(endpointId);
                return;
            }
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
                notifyListeners("connected", event);
            } else {
                event.put("status", result.getStatus().getStatusCode());
                notifyListeners("rejected", event);
            }
        }

        @Override
        public void onDisconnected(String endpointId) {
            if (connected.contains(endpointId)) gone(endpointId);
        }
    };

    private final EndpointDiscoveryCallback discovery = new EndpointDiscoveryCallback() {
        @Override
        public void onEndpointFound(String endpointId, DiscoveredEndpointInfo info) {
            if (!SERVICE_ID.equals(info.getServiceId())) return;
            JSObject found = new JSObject();
            found.put("endpointId", endpointId);
            found.put("name", shorten(info.getEndpointName()));
            notifyListeners("found", found);
        }

        @Override
        public void onEndpointLost(String endpointId) {
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
            byte[] bytes = payload.asBytes();
            if (bytes == null || bytes.length < 1 || bytes.length > ConnectionsClient.MAX_BYTES_DATA_SIZE) return;
            if (!withinRate(endpointId)) return;
            String channel = bytes[0] == 'c' ? "control" : bytes[0] == 'f' ? "fast" : null;
            if (channel == null) return;
            JSObject message = new JSObject();
            message.put("endpointId", endpointId);
            message.put("channel", channel);
            message.put("data", new String(bytes, 1, bytes.length - 1, StandardCharsets.UTF_8));
            notifyListeners("message", message);
        }

        @Override
        public void onPayloadTransferUpdate(String endpointId, PayloadTransferUpdate update) {
            int status = update.getStatus();
            if (status != PayloadTransferUpdate.Status.IN_PROGRESS) released(update.getPayloadId());
        }
    };

    /** A fast message has arrived or failed: the link may take the next one. */
    private void released(long payloadId) {
        String endpointId = fastPayloads.remove(payloadId);
        if (endpointId == null) return;
        Integer inFlight = fastInFlight.get(endpointId);
        if (inFlight != null && inFlight > 0) fastInFlight.put(endpointId, inFlight - 1);
    }

    private boolean withinRate(String endpointId) {
        long now = System.currentTimeMillis();
        long[] window = rates.get(endpointId);
        if (window == null || now - window[0] >= 1000) {
            rates.put(endpointId, new long[] { now, 1 });
            return true;
        }
        window[1]++;
        return window[1] <= MAX_MESSAGES_PER_SECOND;
    }

    private void gone(String endpointId) {
        connected.remove(endpointId);
        fastInFlight.remove(endpointId);
        rates.remove(endpointId);
        fastPayloads.values().removeIf(endpointId::equals);
        JSObject event = new JSObject();
        event.put("endpointId", endpointId);
        notifyListeners("disconnected", event);
    }

    /** The permissions Nearby needs on this phone's Android version. */
    private static String[] neededAliases() {
        if (Build.VERSION.SDK_INT >= 33) return new String[] { "bluetooth", "wifi" };
        if (Build.VERSION.SDK_INT >= 31) return new String[] { "bluetooth", "location" };
        if (Build.VERSION.SDK_INT >= 29) return new String[] { "location" };
        return new String[] { "coarse" };
    }

    private static String shorten(String text) {
        if (text == null) return "";
        return text.length() > MAX_NAME_LENGTH ? text.substring(0, MAX_NAME_LENGTH) : text;
    }

    private static String code(Exception e) {
        return e instanceof ApiException ? "nearby-" + ((ApiException) e).getStatusCode() : "failed";
    }
}
