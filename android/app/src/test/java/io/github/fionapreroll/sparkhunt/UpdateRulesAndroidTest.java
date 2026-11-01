package io.github.fionapreroll.sparkhunt;

import static org.junit.Assert.assertEquals;

import android.content.pm.PackageInstaller;
import java.net.HttpURLConnection;
import org.junit.Test;

/** UpdateRules' copies of Android's constants match Android; this needs the Android build. */
public class UpdateRulesAndroidTest {

    @Test
    public void readsTheInstallersStatusesAsAndroidDefinesThem() {
        assertEquals(PackageInstaller.STATUS_PENDING_USER_ACTION, UpdateRules.STATUS_PENDING_USER_ACTION);
        assertEquals(PackageInstaller.STATUS_SUCCESS, UpdateRules.STATUS_SUCCESS);
        assertEquals(PackageInstaller.STATUS_FAILURE_ABORTED, UpdateRules.STATUS_FAILURE_ABORTED);
    }

    @Test
    public void speaksHttp() {
        assertEquals(HttpURLConnection.HTTP_OK, UpdateRules.HTTP_OK);
        assertEquals(HttpURLConnection.HTTP_PARTIAL, UpdateRules.HTTP_PARTIAL);
    }
}
