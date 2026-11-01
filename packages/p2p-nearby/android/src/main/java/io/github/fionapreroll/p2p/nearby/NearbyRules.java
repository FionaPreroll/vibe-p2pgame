package io.github.fionapreroll.p2p.nearby;

import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * What NearbyPlugin decides, in plain Java without Android, so that JUnit tests it on any
 * computer: names, the game's service, the permissions each Android version needs, how messages
 * travel, the limits on what other phones send, the codes of failures, and the native log.
 */
final class NearbyRules {

    private NearbyRules() {}

    static final int MAX_NAME_LENGTH = 64;
    /** Connection requests waiting for the host's answer at once; more are turned down. */
    static final int MAX_PENDING = 4;
    /** Messages a second taken from one connection; more are dropped before they reach the game. */
    static final int MAX_MESSAGES_PER_SECOND = 120;
    /** Fast messages on their way to one connection; while there are this many, new ones are dropped. */
    static final int MAX_FAST_IN_FLIGHT = 2;
    /** Lines kept for the debug report: what happened, never what was said. */
    static final int MAX_LOG_LINES = 200;
    /** The largest message Nearby carries as bytes (ConnectionsClient.MAX_BYTES_DATA_SIZE). */
    static final int MAX_BYTES = 32768;

    /**
     * The game's own Nearby service, which both sides look for only: 3 to 64 letters, digits,
     * dots, dashes or underscores.
     */
    private static final Pattern SERVICE = Pattern.compile("[A-Za-z0-9._-]{3,64}");

    static boolean isService(String service) {
        return service != null && SERVICE.matcher(service).matches();
    }

    /** A name as Nearby carries it: at most 64 characters, never null. */
    static String shorten(String text) {
        if (text == null) return "";
        return text.length() > MAX_NAME_LENGTH ? text.substring(0, MAX_NAME_LENGTH) : text;
    }

    /**
     * The permissions asked for, to host or to play, on an Android version. Nearby wants location
     * to discover games nearby on every version, even where Google's list says it does not: on
     * Android 17 discovering fails with 8034 MISSING_PERMISSION_ACCESS_COARSE_LOCATION without
     * it. Fine and coarse are asked for together, so the player can choose approximate.
     */
    static List<String> askedAliases(String role, int sdk) {
        List<String> aliases = new ArrayList<>();
        if (sdk >= 31) aliases.add("bluetooth");
        if (sdk >= 33) aliases.add("wifi");
        if (sdk < 29) {
            aliases.add("coarse");
        } else if (sdk < 33 || "player".equals(role)) {
            aliases.add("location");
            aliases.add("coarse");
        }
        return aliases;
    }

    /**
     * The permissions that must be granted: as asked, but from Android 13 on, approximate location
     * is enough to discover; from Android 10 to 12, Nearby wants precise location.
     */
    static List<String> requiredAliases(String role, int sdk) {
        List<String> aliases = new ArrayList<>();
        for (String alias : askedAliases(role, sdk)) {
            if (sdk >= 33 && "location".equals(alias)) continue;
            if (sdk >= 29 && sdk < 33 && "coarse".equals(alias)) continue;
            aliases.add(alias);
        }
        return aliases;
    }

    /** A host turns down a request while it does not advertise, or while enough are waiting. */
    static boolean turnDown(boolean incoming, boolean advertising, int waiting) {
        return incoming && (!advertising || waiting >= MAX_PENDING);
    }

    /**
     * A message as bytes: a letter for its channel, `c`ontrol or `f`ast, then its text; null for
     * another channel, or a message too long for Nearby.
     */
    static byte[] encode(String channel, String data) {
        String tag = "control".equals(channel) ? "c" : "fast".equals(channel) ? "f" : null;
        if (tag == null || data == null) return null;
        byte[] bytes = (tag + data).getBytes(StandardCharsets.UTF_8);
        return bytes.length > MAX_BYTES ? null : bytes;
    }

    /** A message from bytes, as its channel and text; null for anything that is not one. */
    static String[] decode(byte[] bytes) {
        if (bytes == null || bytes.length < 1 || bytes.length > MAX_BYTES) return null;
        String channel = bytes[0] == 'c' ? "control" : bytes[0] == 'f' ? "fast" : null;
        if (channel == null) return null;
        return new String[] { channel, new String(bytes, 1, bytes.length - 1, StandardCharsets.UTF_8) };
    }

    /**
     * The code a failed step is handed back with: `permission` for a permission Nearby misses, which
     * the player can give; `location-off` for a failed discovery while Location is off;
     * otherwise Nearby's own status, as `nearby-8007`, or `failed` without one.
     */
    static String failureCode(Integer status, String statusName, Boolean locationOn, String step) {
        if (status != null && statusName != null && statusName.startsWith("MISSING_PERMISSION")) return "permission";
        if (Boolean.FALSE.equals(locationOn) && "discover".equals(step)) return "location-off";
        return status != null ? "nearby-" + status : "failed";
    }

    /** At most so many messages a second from each connection; the window starts anew each second. */
    static final class RateLimit {
        private final int perSecond;
        private final Map<String, long[]> windows = new HashMap<>();

        RateLimit(int perSecond) {
            this.perSecond = perSecond;
        }

        boolean allow(String endpointId, long now) {
            long[] window = windows.get(endpointId);
            if (window == null || now - window[0] >= 1000) {
                windows.put(endpointId, new long[] { now, 1 });
                return true;
            }
            window[1]++;
            return window[1] <= perSecond;
        }

        void forget(String endpointId) {
            windows.remove(endpointId);
        }

        void clear() {
            windows.clear();
        }
    }

    /**
     * The fast messages on their way to each connection: while a link is busy, new ones are dropped
     * instead of piling up, as only the newest state counts.
     */
    static final class FastLanes {
        private final int max;
        private final Map<String, Integer> inFlight = new HashMap<>();
        private final Map<Long, String> payloads = new HashMap<>();

        FastLanes(int max) {
            this.max = max;
        }

        /** Whether a fast message to this connection may go now. */
        boolean free(String endpointId) {
            Integer count = inFlight.get(endpointId);
            return count == null || count < max;
        }

        /** A fast message went out. */
        void sent(String endpointId, long payloadId) {
            payloads.put(payloadId, endpointId);
            inFlight.put(endpointId, inFlight.getOrDefault(endpointId, 0) + 1);
        }

        /** A fast message arrived or failed: the link may take the next one. */
        void released(long payloadId) {
            String endpointId = payloads.remove(payloadId);
            if (endpointId == null) return;
            Integer count = inFlight.get(endpointId);
            if (count != null && count > 0) inFlight.put(endpointId, count - 1);
        }

        void forget(String endpointId) {
            inFlight.remove(endpointId);
            payloads.values().removeIf(endpointId::equals);
        }

        void clear() {
            inFlight.clear();
            payloads.clear();
        }

        int inFlight(String endpointId) {
            return inFlight.getOrDefault(endpointId, 0);
        }
    }

    /** The last lines of what happened, each with the seconds since the plugin loaded. */
    static final class DebugLog {
        private final long loadedAt;
        private final int max;
        private final ArrayDeque<String> lines = new ArrayDeque<>();

        DebugLog(long loadedAt, int max) {
            this.loadedAt = loadedAt;
            this.max = max;
        }

        void add(String line, long now) {
            lines.addLast("+" + (now - loadedAt) / 1000 + "s " + line);
            while (lines.size() > max) lines.removeFirst();
        }

        List<String> lines() {
            return new ArrayList<>(lines);
        }
    }
}
