package io.github.fionapreroll.p2p.nearby;

import static org.junit.Assert.assertEquals;

import com.google.android.gms.nearby.connection.ConnectionsClient;
import org.junit.Test;

/** NearbyRules' copies of Nearby's own limits match Nearby; this needs the Android build. */
public class NearbyRulesAndroidTest {

    @Test
    public void carriesAsMuchAsNearbyDoes() {
        assertEquals(ConnectionsClient.MAX_BYTES_DATA_SIZE, NearbyRules.MAX_BYTES);
    }
}
