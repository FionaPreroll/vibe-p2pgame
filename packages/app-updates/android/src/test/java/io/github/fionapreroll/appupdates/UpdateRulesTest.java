package io.github.fionapreroll.appupdates;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** AppUpdaterPlugin's decisions, without Android: see UpdateRules. */
public class UpdateRulesTest {

    private static final String RELEASES = "https://github.com/FionaPreroll/vibe-p2pgame/releases/";

    @Test
    public void takesOnlyTheReleasesOfOneGitHubRepository() {
        assertTrue(UpdateRules.soundReleases(RELEASES));
        assertTrue(UpdateRules.soundReleases("https://github.com/a-b/c.d_e/releases/"));
        for (String releases : new String[] {
            null,
            "",
            "http://github.com/FionaPreroll/vibe-p2pgame/releases/",
            "https://github.com/FionaPreroll/vibe-p2pgame/releases",
            "https://github.com/FionaPreroll/releases/",
            "https://github.com/FionaPreroll/vibe-p2pgame/",
            "https://github.com.example.com/FionaPreroll/vibe-p2pgame/releases/",
            "https://github.com/FionaPreroll/../releases/",
            "https://example.com/FionaPreroll/vibe-p2pgame/releases/",
        }) {
            assertFalse(String.valueOf(releases), UpdateRules.soundReleases(releases));
        }
    }

    @Test
    public void readsOnlyTheAppsReleases() {
        assertTrue(UpdateRules.fromReleases(RELEASES + "latest/download/version.json", RELEASES));
        for (String url : new String[] {
            null,
            "",
            "http://github.com/FionaPreroll/vibe-p2pgame/releases/latest/download/spark-hunt.apk",
            "https://github.com/FionaPreroll/other/releases/latest/download/spark-hunt.apk",
            "https://example.com/" + RELEASES,
            RELEASES + "../../other/releases/x.apk",
        }) {
            assertFalse(String.valueOf(url), UpdateRules.fromReleases(url, RELEASES));
        }
        // Without sound releases in the config, nothing.
        assertFalse(UpdateRules.fromReleases(RELEASES + "latest/download/version.json", ""));
        assertFalse(UpdateRules.fromReleases("https://example.com/x.apk", "https://example.com/"));
    }

    @Test
    public void goesOnWhereADownloadStopped() {
        // Asked for the rest and got it: on from what is there.
        assertTrue(UpdateRules.acceptable(206, 4096));
        assertEquals(4096, UpdateRules.resumeFrom(4096, 206));
        // The server sends the whole file instead: from the start.
        assertTrue(UpdateRules.acceptable(200, 4096));
        assertEquals(0, UpdateRules.resumeFrom(4096, 200));
        // Nothing there: the whole file.
        assertTrue(UpdateRules.acceptable(200, 0));
        assertEquals(0, UpdateRules.resumeFrom(0, 206));
        // A 206 nobody asked for, or anything else, is not read.
        assertFalse(UpdateRules.acceptable(206, 0));
        assertFalse(UpdateRules.acceptable(416, 4096));
        assertFalse(UpdateRules.acceptable(404, 0));
    }

    @Test
    public void knowsTheWholeSizeOnlyWhenTheServerSaysIt() {
        assertEquals(10_000, UpdateRules.total(4_000, 6_000));
        assertEquals(6_000, UpdateRules.total(0, 6_000));
        assertEquals(-1, UpdateRules.total(4_000, -1));
        assertEquals(40, UpdateRules.percent(4_000, 10_000));
        assertEquals(-1, UpdateRules.percent(4_000, -1));
    }

    @Test
    public void dropsOnlyPartsOfNoUse() {
        assertTrue(UpdateRules.dropPart("Too large"));
        assertTrue(UpdateRules.dropPart("HTTP 416"));
        assertFalse(UpdateRules.dropPart("Cut short"));
        assertFalse(UpdateRules.dropPart("HTTP 503"));
        assertFalse(UpdateRules.dropPart(null));
    }

    @Test
    public void keepsOnePartPerBuild() {
        assertEquals("update-12.part", UpdateRules.partName(12));
        assertTrue(UpdateRules.otherPart("update-11.part", 12));
        assertFalse(UpdateRules.otherPart("update-12.part", 12));
        assertFalse(UpdateRules.otherPart(UpdateRules.APK, 12));
        // What an app's own updater left before: of no use.
        assertTrue(UpdateRules.otherPart("spark-hunt.apk", 12));
        assertTrue(UpdateRules.otherPart("spark-hunt-12.part", 12));
        assertFalse(UpdateRules.otherPart("notes.txt", 12));
    }

    @Test
    public void tellsTheProgressAtEveryPercentOrNowAndThen() {
        UpdateRules.ProgressGate gate = new UpdateRules.ProgressGate();
        assertTrue(gate.due(0, 1_000));
        assertFalse(gate.due(0, 1_100));
        assertTrue(gate.due(1, 1_150));
        assertFalse(gate.due(1, 1_399));
        assertTrue(gate.due(1, 1_400));
        // While the size is unknown, now and then.
        assertTrue(gate.due(-1, 2_000));
        assertFalse(gate.due(-1, 2_100));
        assertTrue(gate.due(-1, 2_250));
    }

    @Test
    public void readsTheInstallersAnswer() {
        assertEquals("confirm", UpdateRules.installStatus(UpdateRules.STATUS_PENDING_USER_ACTION));
        assertEquals("success", UpdateRules.installStatus(UpdateRules.STATUS_SUCCESS));
        assertEquals("aborted", UpdateRules.installStatus(UpdateRules.STATUS_FAILURE_ABORTED));
        assertEquals("failure", UpdateRules.installStatus(1));
        assertEquals("failure", UpdateRules.installStatus(7));
        assertEquals("", UpdateRules.shortMessage(null));
        assertEquals("INSTALL_FAILED", UpdateRules.shortMessage("INSTALL_FAILED"));
        assertEquals(200, UpdateRules.shortMessage(new String(new char[500]).replace('\0', 'x')).length());
    }
}
