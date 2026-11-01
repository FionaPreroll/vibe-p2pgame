package io.github.fionapreroll.sparkhunt;

/**
 * What AppUpdaterPlugin decides, in plain Java without Android, so that JUnit tests it on any
 * computer: where it may read and download from, how a download goes on where it stopped, its
 * limits, how often it tells its progress, and what Android's installer answered.
 */
final class UpdateRules {

    private UpdateRules() {}

    /** Only the game's own releases are read, and followed where GitHub redirects them. */
    static final String RELEASES = "https://github.com/FionaPreroll/vibe-p2pgame/releases/";
    static final long MAX_APK_BYTES = 200L * 1024 * 1024;
    static final int MAX_TEXT_BYTES = 64 * 1024;
    /** Progress is told at most this often, in milliseconds, and at every whole percent. */
    static final long PROGRESS_MS = 250;

    static final int HTTP_OK = 200;
    static final int HTTP_PARTIAL = 206;
    static final int HTTP_RANGE_NOT_SATISFIABLE = 416;

    /** PackageInstaller's statuses, as Android defines them (see UpdateRulesAndroidTest). */
    static final int STATUS_PENDING_USER_ACTION = -1;
    static final int STATUS_SUCCESS = 0;
    static final int STATUS_FAILURE_ABORTED = 3;

    /** Whether an address is of this game's releases, over HTTPS. */
    static boolean fromReleases(String url) {
        return url != null && url.startsWith(RELEASES) && !url.contains("..");
    }

    /**
     * Whether a server's answer may be read: the whole file (200), or the rest of it (206) when the
     * download asked for the bytes from `from` on.
     */
    static boolean acceptable(int status, long from) {
        return status == HTTP_OK || (from > 0 && status == HTTP_PARTIAL);
    }

    /** Where the bytes of an answer go on from: after what is there for a 206, from 0 otherwise. */
    static long resumeFrom(long have, int status) {
        return have > 0 && status == HTTP_PARTIAL ? have : 0;
    }

    /** The whole file's size, from what is there and what the answer brings; -1 while unknown. */
    static long total(long have, long rest) {
        return rest >= 0 ? have + rest : -1;
    }

    /**
     * Whether a part downloaded so far is of no use any more: one that is too large, or one the
     * server will not go on from (416).
     */
    static boolean dropPart(String failure) {
        return "Too large".equals(failure) || ("HTTP " + HTTP_RANGE_NOT_SATISFIABLE).equals(failure);
    }

    /** The part a download of a build keeps, until it is whole. */
    static String partName(int build) {
        return "spark-hunt-" + build + ".part";
    }

    /** Parts of other builds are of no use any more. */
    static boolean otherPart(String fileName, int build) {
        return fileName.endsWith(".part") && !fileName.equals(partName(build));
    }

    /** The percent done, or -1 while the size is unknown. */
    static int percent(long done, long total) {
        return total > 0 ? (int) (done * 100 / total) : -1;
    }

    /** When to tell the progress: at every new percent, or after `PROGRESS_MS` at the latest. */
    static final class ProgressGate {
        private int shown = Integer.MIN_VALUE;
        private long told = Long.MIN_VALUE / 2;

        boolean due(int percent, long now) {
            if (percent == shown && now - told < PROGRESS_MS) return false;
            shown = percent;
            told = now;
            return true;
        }
    }

    /** What the installer's status means for the game: `confirm`, `success`, `aborted` or `failure`. */
    static String installStatus(int status) {
        switch (status) {
            case STATUS_PENDING_USER_ACTION:
                return "confirm";
            case STATUS_SUCCESS:
                return "success";
            case STATUS_FAILURE_ABORTED:
                return "aborted";
            default:
                return "failure";
        }
    }

    /** Android's message, short enough for the dialog. */
    static String shortMessage(String message) {
        if (message == null) return "";
        return message.length() > 200 ? message.substring(0, 200) : message;
    }
}
