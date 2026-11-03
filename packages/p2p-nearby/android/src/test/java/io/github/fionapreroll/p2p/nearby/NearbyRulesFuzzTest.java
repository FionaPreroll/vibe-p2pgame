package io.github.fionapreroll.p2p.nearby;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.junit.Test;

/**
 * NearbyRules against what a hostile phone nearby can send: random bytes, names and timings, from
 * a fixed seed so that a failure comes back the same. These are the first lines of code to read
 * another phone's bytes, before the library checks them again.
 */
public class NearbyRulesFuzzTest {

    private static final int RUNS = 20_000;

    @Test
    public void decodesAnyBytesSafely() {
        Random random = new Random(7);
        for (int run = 0; run < RUNS; run++) {
            byte[] bytes = randomBytes(random);
            String[] message = NearbyRules.decode(bytes);
            if (bytes == null || bytes.length == 0 || bytes.length > NearbyRules.MAX_BYTES) {
                assertNull(message);
                continue;
            }
            if (bytes[0] != 'c' && bytes[0] != 'f') {
                assertNull(message);
                continue;
            }
            // A message has a known channel and its text, nothing else.
            assertNotNull(message);
            assertEquals(2, message.length);
            assertEquals(bytes[0] == 'c' ? "control" : "fast", message[0]);
            assertNotNull(message[1]);
        }
    }

    @Test
    public void sendsWhatItTakesUnchanged() {
        Random random = new Random(11);
        for (int run = 0; run < RUNS; run++) {
            String channel = random.nextBoolean() ? "control" : "fast";
            String text = randomText(random, random.nextInt(4) == 0 ? 40_000 : 200);
            byte[] bytes = NearbyRules.encode(channel, text);
            int size = 1 + text.getBytes(StandardCharsets.UTF_8).length;
            if (size > NearbyRules.MAX_BYTES) {
                assertNull(bytes);
                continue;
            }
            assertNotNull(bytes);
            String[] back = NearbyRules.decode(bytes);
            assertNotNull(back);
            assertEquals(channel, back[0]);
            // Well-formed text arrives unchanged. Lone surrogate halves cannot be UTF-8 and arrive
            // replaced; the game never sends any, as JSON.stringify escapes them.
            if (StandardCharsets.UTF_8.newEncoder().canEncode(text)) assertEquals(text, back[1]);
        }
        // Another channel, or nothing to send, never goes out.
        assertNull(NearbyRules.encode("other", "x"));
        assertNull(NearbyRules.encode(null, "x"));
        assertNull(NearbyRules.encode("control", null));
    }

    @Test
    public void neverTakesMoreThanTheRateFromAnyPhone() {
        Random random = new Random(13);
        int perSecond = NearbyRules.MAX_MESSAGES_PER_SECOND;
        NearbyRules.RateLimit limit = new NearbyRules.RateLimit(perSecond);
        Map<String, ArrayDeque<Long>> taken = new HashMap<>();
        long now = 0;
        for (int run = 0; run < RUNS * 5; run++) {
            // Mostly floods, now and then a pause; phones come and go.
            now += random.nextInt(10) == 0 ? random.nextInt(3000) : random.nextInt(3);
            String endpoint = "E" + random.nextInt(4);
            if (random.nextInt(500) == 0) {
                limit.forget(endpoint);
                taken.remove(endpoint);
                continue;
            }
            if (limit.allow(endpoint, now)) {
                ArrayDeque<Long> times = taken.computeIfAbsent(endpoint, e -> new ArrayDeque<>());
                times.addLast(now);
                while (!times.isEmpty() && now - times.peekFirst() >= 2000) times.removeFirst();
                // Within any two seconds, at most two windows' worth.
                assertTrue(times.size() <= 2 * perSecond);
            }
        }
    }

    @Test
    public void neverHasMoreFastMessagesOnTheWayThanAllowed() {
        Random random = new Random(17);
        int max = NearbyRules.MAX_FAST_IN_FLIGHT;
        NearbyRules.FastLanes lanes = new NearbyRules.FastLanes(max);
        List<Long> sent = new ArrayList<>();
        long next = 1;
        for (int run = 0; run < RUNS; run++) {
            String endpoint = "E" + random.nextInt(3);
            switch (random.nextInt(4)) {
                case 0:
                case 1:
                    // The plugin sends only while the lane is free.
                    if (lanes.free(endpoint)) {
                        lanes.sent(endpoint, next);
                        sent.add(next++);
                    }
                    break;
                case 2:
                    // Nearby reports any payload, also ones it made up or reported before.
                    long payload = sent.isEmpty() || random.nextBoolean()
                        ? random.nextLong()
                        : sent.get(random.nextInt(sent.size()));
                    lanes.released(payload);
                    break;
                default:
                    if (random.nextInt(50) == 0) lanes.forget(endpoint);
                    break;
            }
            for (int e = 0; e < 3; e++) {
                int inFlight = lanes.inFlight("E" + e);
                assertTrue(inFlight >= 0 && inFlight <= max);
            }
        }
    }

    @Test
    public void keepsNamesAndTheLogShort() {
        Random random = new Random(19);
        NearbyRules.DebugLog log = new NearbyRules.DebugLog(0, NearbyRules.MAX_LOG_LINES);
        for (int run = 0; run < RUNS; run++) {
            String text = random.nextInt(10) == 0 ? null : randomText(random, 300);
            assertTrue(NearbyRules.shorten(text).length() <= NearbyRules.MAX_NAME_LENGTH);
            NearbyRules.isService(text);
            log.add("line " + run, run);
            assertTrue(log.lines().size() <= NearbyRules.MAX_LOG_LINES);
        }
    }

    /** Bytes of any length up to past the limit, often with a channel's letter in front. */
    private static byte[] randomBytes(Random random) {
        if (random.nextInt(50) == 0) return null;
        int length = random.nextInt(8) == 0
            ? NearbyRules.MAX_BYTES - 2 + random.nextInt(5)
            : random.nextInt(300);
        byte[] bytes = new byte[length];
        random.nextBytes(bytes);
        if (length > 0 && random.nextBoolean()) bytes[0] = (byte) (random.nextBoolean() ? 'c' : 'f');
        return bytes;
    }

    /** Text with any characters, surrogate halves and controls among them. */
    private static String randomText(Random random, int maxLength) {
        int length = random.nextInt(maxLength + 1);
        StringBuilder text = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            int kind = random.nextInt(4);
            text.append(kind == 0 ? (char) random.nextInt(0x10000) : kind == 1 ? (char) random.nextInt(32) : (char) ('a' + random.nextInt(26)));
        }
        return text.toString();
    }
}
