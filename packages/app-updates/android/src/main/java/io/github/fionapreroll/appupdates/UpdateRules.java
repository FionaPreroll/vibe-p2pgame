package io.github.fionapreroll.appupdates;

/**
 * What AppUpdaterPlugin decides, in plain Java without Android, so that JUnit tests it on any
 * computer: which releases an app may name, where it may read and download from, how a download goes on where it stopped, its
 * limits, how often it tells its progress, and what Android's installer answered.
 */
final class UpdateRules {

    private UpdateRules() {}

    /** The APK downloaded last, ready to install, in the plugin's own folder of the cache. */
    static final String APK = "update.apk";
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

    /**
     * Whether the app's Capacitor config names sound releases (`plugins.AppUpdater.releases`):
     * those of one GitHub repository, as `https://github.com/<owner>/<repository>/releases/`.
     * Only these are read, and followed where GitHub redirects them.
     */
    static boolean soundReleases(String releases) {
        return releases != null
            && releases.matches("https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/releases/")
            && !releases.contains("..");
    }

    /** Whether an address is of the app's own releases, over HTTPS. */
    static boolean fromReleases(String url, String releases) {
        return soundReleases(releases) && url != null && url.startsWith(releases) && !url.contains("..");
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
        return "update-" + build + ".part";
    }

    /**
     * Files of no use any more: parts of other builds, and APKs under other names, such as those
     * an app's own updater kept before it used this plugin.
     */
    static boolean otherPart(String fileName, int build) {
        if (fileName.endsWith(".part")) return !fileName.equals(partName(build));
        return fileName.endsWith(".apk") && !fileName.equals(APK);
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

    /** What the installer's status means for the app: `confirm`, `success`, `aborted` or `failure`. */
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
