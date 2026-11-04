package io.github.fionapreroll.p2p.nearby;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import com.google.android.gms.nearby.connection.BandwidthInfo;
import com.google.android.gms.nearby.connection.ConnectionsClient;
import org.junit.Test;

/** NearbyRules' limits fit Nearby's own; this needs the Android build. */
public class NearbyRulesAndroidTest {

    @Test
    public void sendsNothingLargerThanNearbyCarries() {
        assertTrue(
            "Nearby carries " + ConnectionsClient.MAX_BYTES_DATA_SIZE + " bytes",
            NearbyRules.MAX_BYTES <= ConnectionsClient.MAX_BYTES_DATA_SIZE
        );
    }

    @Test
    public void readsBandwidthByNearbysOwnNumbers() {
        assertEquals(BandwidthInfo.Quality.UNKNOWN, NearbyRules.QUALITY_UNKNOWN);
        assertEquals(BandwidthInfo.Quality.LOW, NearbyRules.QUALITY_LOW);
        assertEquals(BandwidthInfo.Quality.MEDIUM, NearbyRules.QUALITY_MEDIUM);
        assertEquals(BandwidthInfo.Quality.HIGH, NearbyRules.QUALITY_HIGH);
    }
}
