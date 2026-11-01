package io.github.fionapreroll.p2p.nearby;

import static org.junit.Assert.assertTrue;

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
}
