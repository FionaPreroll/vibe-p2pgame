package io.github.fionapreroll.p2p.nearby;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

/** NearbyPlugin's decisions, without Android: see NearbyRules. */
public class NearbyRulesTest {

    @Test
    public void takesOnlyASoundServiceName() {
        assertTrue(NearbyRules.isService("io.github.fionapreroll.sparkhunt.game"));
        assertTrue(NearbyRules.isService("a-b_c"));
        for (String bad : new String[] { null, "", "ab", "has space", "ünï", new String(new char[65]).replace('\0', 'x') }) {
            assertFalse(bad, NearbyRules.isService(bad));
        }
    }

    @Test
    public void shortensNamesToSixtyFourCharacters() {
        assertEquals("", NearbyRules.shorten(null));
        assertEquals("Ada", NearbyRules.shorten("Ada"));
        String long_ = new String(new char[100]).replace('\0', 'x');
        assertEquals(64, NearbyRules.shorten(long_).length());
    }

    @Test
    public void asksForWhatEachAndroidVersionNeeds() {
        // Up to Android 9: coarse location only, as the old Bluetooth permissions are granted at install.
        assertEquals(Collections.singletonList("coarse"), NearbyRules.askedAliases("player", 28));
        assertEquals(Collections.singletonList("coarse"), NearbyRules.requiredAliases("host", 28));
        // Android 10 and 11: precise location, which Nearby wants there.
        assertEquals(Arrays.asList("location", "coarse"), NearbyRules.askedAliases("host", 29));
        assertEquals(Collections.singletonList("location"), NearbyRules.requiredAliases("host", 29));
        // Android 12: Bluetooth permissions besides.
        assertEquals(Arrays.asList("bluetooth", "location", "coarse"), NearbyRules.askedAliases("player", 31));
        assertEquals(Arrays.asList("bluetooth", "location"), NearbyRules.requiredAliases("player", 31));
        // Android 13 on: nearby Wi-Fi too; players need approximate location, hosts none.
        assertEquals(Arrays.asList("bluetooth", "wifi", "location", "coarse"), NearbyRules.askedAliases("player", 33));
        assertEquals(Arrays.asList("bluetooth", "wifi", "coarse"), NearbyRules.requiredAliases("player", 37));
        assertEquals(Arrays.asList("bluetooth", "wifi"), NearbyRules.askedAliases("host", 37));
        assertEquals(Arrays.asList("bluetooth", "wifi"), NearbyRules.requiredAliases("host", 37));
    }

    @Test
    public void turnsDownRequestsWhileNotHostingOrFull() {
        assertFalse(NearbyRules.turnDown(true, true, 0));
        assertFalse(NearbyRules.turnDown(true, true, NearbyRules.MAX_PENDING - 1));
        assertTrue(NearbyRules.turnDown(true, true, NearbyRules.MAX_PENDING));
        assertTrue(NearbyRules.turnDown(true, false, 0));
        // An answer to this phone's own request is no request to turn down.
        assertFalse(NearbyRules.turnDown(false, false, 99));
    }

    @Test
    public void encodesAndDecodesMessagesWithTheirChannel() {
        byte[] control = NearbyRules.encode("control", "{\"a\":1}");
        assertArrayEquals("c{\"a\":1}".getBytes(StandardCharsets.UTF_8), control);
        assertArrayEquals(new String[] { "control", "{\"a\":1}" }, NearbyRules.decode(control));
        assertArrayEquals(new String[] { "fast", "ü€" }, NearbyRules.decode(NearbyRules.encode("fast", "ü€")));
        assertArrayEquals(new String[] { "fast", "" }, NearbyRules.decode(NearbyRules.encode("fast", "")));
        assertNull(NearbyRules.encode("other", "x"));
        assertNull(NearbyRules.encode("fast", null));
        assertNull(NearbyRules.encode("fast", new String(new char[NearbyRules.MAX_BYTES]).replace('\0', 'x')));
    }

    @Test
    public void dropsBytesThatAreNoMessage() {
        assertNull(NearbyRules.decode(null));
        assertNull(NearbyRules.decode(new byte[0]));
        assertNull(NearbyRules.decode("xhello".getBytes(StandardCharsets.UTF_8)));
        assertNull(NearbyRules.decode(new byte[NearbyRules.MAX_BYTES + 1]));
    }

    @Test
    public void namesFailuresSoThatTheGameCanSayWhy() {
        assertEquals("permission", NearbyRules.failureCode(8034, "MISSING_PERMISSION_ACCESS_COARSE_LOCATION", true, "discover"));
        assertEquals("location-off", NearbyRules.failureCode(8007, "STATUS_RADIO_ERROR", false, "discover"));
        // Location matters only to discovering.
        assertEquals("nearby-8007", NearbyRules.failureCode(8007, "STATUS_RADIO_ERROR", false, "advertise"));
        assertEquals("nearby-8007", NearbyRules.failureCode(8007, "STATUS_RADIO_ERROR", null, "discover"));
        assertEquals("failed", NearbyRules.failureCode(null, null, true, "connect to E1"));
    }

    @Test
    public void takesAtMostSoManyMessagesASecondFromEachConnection() {
        NearbyRules.RateLimit limit = new NearbyRules.RateLimit(3);
        for (int i = 0; i < 3; i++) assertTrue(limit.allow("E1", 1000 + i));
        assertFalse(limit.allow("E1", 1500));
        // Another connection has its own window.
        assertTrue(limit.allow("E2", 1500));
        // A second later, the window starts anew.
        assertTrue(limit.allow("E1", 2000));
        assertTrue(limit.allow("E1", 2001));
        limit.forget("E1");
        for (int i = 0; i < 3; i++) assertTrue(limit.allow("E1", 2002));
        limit.clear();
        assertTrue(limit.allow("E2", 2003));
    }

    @Test
    public void dropsFastMessagesWhileTheLinkIsBusy() {
        NearbyRules.FastLanes lanes = new NearbyRules.FastLanes(2);
        assertTrue(lanes.free("E1"));
        lanes.sent("E1", 1);
        lanes.sent("E1", 2);
        assertFalse(lanes.free("E1"));
        assertTrue(lanes.free("E2"));
        lanes.released(1);
        assertTrue(lanes.free("E1"));
        assertEquals(1, lanes.inFlight("E1"));
        // A payload released twice, or never sent, changes nothing.
        lanes.released(1);
        lanes.released(99);
        assertEquals(1, lanes.inFlight("E1"));
        lanes.forget("E1");
        assertEquals(0, lanes.inFlight("E1"));
        lanes.released(2);
        assertEquals(0, lanes.inFlight("E1"));
        lanes.sent("E2", 3);
        lanes.clear();
        assertEquals(0, lanes.inFlight("E2"));
    }

    @Test
    public void keepsTheNewestLinesWithTheirSeconds() {
        NearbyRules.DebugLog log = new NearbyRules.DebugLog(10_000, 3);
        log.add("start host", 10_500);
        log.add("advertising", 12_000);
        log.add("request from E1", 15_999);
        log.add("accepting E1", 16_000);
        assertEquals(Arrays.asList("+2s advertising", "+5s request from E1", "+6s accepting E1"), log.lines());
    }
}
