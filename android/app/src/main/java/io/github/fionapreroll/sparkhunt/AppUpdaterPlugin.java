package io.github.fionapreroll.sparkhunt;

import android.content.Intent;
import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.atomic.AtomicBoolean;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Updates the app from its GitHub release, for src/updates.ts: reads the installed build number,
 * reads the release's version.json, downloads the new APK and hands it to Android's package
 * installer. The installer asks the player, and takes the APK only if it is signed with the same
 * key as the app installed.
 *
 * A download can be paused and goes on where it stopped, also after the app was closed: the part
 * downloaded so far is kept per build, and the rest asked for with an HTTP range.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    /** Only the game's own releases are read, and followed where GitHub redirects them. */
    private static final String RELEASES = "https://github.com/FionaPreroll/vibe-p2pgame/releases/";
    private static final long MAX_APK_BYTES = 200L * 1024 * 1024;
    private static final int MAX_TEXT_BYTES = 64 * 1024;
    /** Progress is told at most this often, in milliseconds, and at every whole percent. */
    private static final long PROGRESS_MS = 250;

    /** Set to stop the running download, keeping what it has. */
    private final AtomicBoolean pausing = new AtomicBoolean(false);
    private final AtomicBoolean downloading = new AtomicBoolean(false);

    /** The build number and name of the app installed. */
    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long build = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            JSObject result = new JSObject();
            result.put("build", build);
            result.put("name", info.versionName);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("No package info", e);
        }
    }

    /** A short text file from the releases, such as version.json. */
    @PluginMethod
    public void fetchText(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith(RELEASES)) {
            call.reject("Not a release of this game");
            return;
        }
        execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = open(url);
                try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        if (out.size() + read > MAX_TEXT_BYTES) throw new IOException("Too long");
                        out.write(buffer, 0, read);
                    }
                    JSObject result = new JSObject();
                    result.put("text", new String(out.toByteArray(), StandardCharsets.UTF_8));
                    call.resolve(result);
                }
            } catch (Exception e) {
                call.reject("Could not read " + url, e);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    /**
     * Downloads the APK of a build from the releases into the app's cache, telling its progress
     * as bytes done and in all. What an earlier, paused or broken download of the same build left
     * is kept, and only the rest is downloaded. Rejects with the code "paused" when paused.
     */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        Integer build = call.getInt("build");
        if (!url.startsWith(RELEASES)) {
            call.reject("Not a release of this game");
            return;
        }
        if (build == null || build < 1) {
            call.reject("No build");
            return;
        }
        if (!downloading.compareAndSet(false, true)) {
            call.reject("A download is running", "busy");
            return;
        }
        pausing.set(false);
        execute(() -> {
            HttpURLConnection connection = null;
            File part = partFile(build);
            try {
                part.getParentFile().mkdirs();
                forgetOtherParts(build);
                long have = part.exists() ? part.length() : 0;
                connection = open(url, have);
                boolean resumed = have > 0 && connection.getResponseCode() == HttpURLConnection.HTTP_PARTIAL;
                if (!resumed) have = 0;
                long rest = connection.getContentLengthLong();
                long total = rest >= 0 ? have + rest : -1;
                if (total > MAX_APK_BYTES) throw new IOException("Too large");
                try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part, resumed)) {
                    byte[] buffer = new byte[64 * 1024];
                    long done = have;
                    long told = 0;
                    int shown = -1;
                    int read;
                    progress(done, total);
                    while ((read = in.read(buffer)) != -1) {
                        if (pausing.get()) {
                            out.flush();
                            call.reject("Paused", "paused");
                            return;
                        }
                        done += read;
                        if (done > MAX_APK_BYTES) throw new IOException("Too large");
                        out.write(buffer, 0, read);
                        int percent = total > 0 ? (int) (done * 100 / total) : -1;
                        long now = System.currentTimeMillis();
                        if (percent != shown || now - told >= PROGRESS_MS) {
                            shown = percent;
                            told = now;
                            progress(done, total);
                        }
                    }
                    if (total > 0 && done != total) throw new IOException("Cut short");
                }
                File apk = apkFile();
                apk.delete();
                if (!part.renameTo(apk)) throw new IOException("Could not keep the download");
                call.resolve();
            } catch (Exception e) {
                // What arrived stays, for the next try to go on from; a file too large does not,
                // nor a part the server will not go on from.
                String message = e.getMessage() == null ? "" : e.getMessage();
                if (message.equals("Too large") || message.equals("HTTP 416")) part.delete();
                call.reject("Download failed", e);
            } finally {
                if (connection != null) connection.disconnect();
                downloading.set(false);
            }
        });
    }

    /** Stops the running download where it is; `download` goes on from there. */
    @PluginMethod
    public void pauseDownload(PluginCall call) {
        pausing.set(true);
        call.resolve();
    }

    /** How many bytes of a build an earlier download left, or 0. */
    @PluginMethod
    public void partial(PluginCall call) {
        Integer build = call.getInt("build");
        File part = build == null ? null : partFile(build);
        JSObject result = new JSObject();
        result.put("bytes", part != null && part.exists() ? part.length() : 0);
        call.resolve(result);
    }

    /**
     * Whether the phone is online now, and whether that costs: metered, as mobile data and some
     * hotspots are, or mobile data itself.
     */
    @PluginMethod
    public void network(PluginCall call) {
        JSObject result = new JSObject();
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        Network network = manager == null ? null : manager.getActiveNetwork();
        NetworkCapabilities capabilities = network == null ? null : manager.getNetworkCapabilities(network);
        result.put("online", capabilities != null);
        result.put("metered", manager != null && manager.isActiveNetworkMetered());
        result.put("cellular", capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR));
        call.resolve(result);
    }

    private void progress(long done, long total) {
        JSObject progress = new JSObject();
        progress.put("done", done);
        progress.put("total", total);
        notifyListeners("progress", progress);
    }

    /**
     * The build of the APK downloaded last, read from the file itself, or -1 if there is none. So
     * a download is not repeated, and an old file is never taken for the new build.
     */
    @PluginMethod
    public void downloaded(PluginCall call) {
        JSObject result = new JSObject();
        result.put("build", downloadedBuild());
        call.resolve(result);
    }

    /** Whether the app may hand APKs to the installer, without opening any setting. */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(result);
    }

    /**
     * Hands the downloaded APK to Android's installer. Without the right to install apps, it opens
     * that setting instead and rejects with the code "permission": the player allows it there and
     * the app goes on.
     *
     * The APK goes into a PackageInstaller session, which tells how it goes as "install" events:
     * "confirm" when Android's dialog asking the player is open, "success", "aborted" when the
     * player said no, or "failure" with Android's message. Where a session cannot be made, the APK
     * is opened with the installer the old way, which tells nothing.
     */
    @PluginMethod
    public void install(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            Intent settings = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getContext().getPackageName())
            );
            settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(settings);
            call.reject("Installing apps is not allowed yet", "permission");
            return;
        }
        File apk = apkFile();
        if (!apk.exists() || downloadedBuild() < 0) {
            call.reject("Nothing downloaded", "nothing-downloaded");
            return;
        }
        execute(() -> {
            try {
                installWithSession(apk);
                JSObject result = new JSObject();
                result.put("way", "session");
                call.resolve(result);
            } catch (Exception e) {
                try {
                    installWithIntent(apk);
                    JSObject result = new JSObject();
                    result.put("way", "intent");
                    call.resolve(result);
                } catch (Exception again) {
                    call.reject("The installer did not open: " + again.getMessage(), "installer", again);
                }
            }
        });
    }

    private BroadcastReceiver installResults;

    private String resultAction() {
        return getContext().getPackageName() + ".INSTALL_RESULT";
    }

    private void installWithSession(File apk) throws IOException {
        listenForInstallResults();
        PackageInstaller installer = getContext().getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(getContext().getPackageName());
        int id = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("spark-hunt.apk", 0, apk.length())) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                session.fsync(out);
            }
            Intent callback = new Intent(resultAction()).setPackage(getContext().getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            PendingIntent pending = PendingIntent.getBroadcast(getContext(), id, callback, flags);
            session.commit(pending.getIntentSender());
        } catch (IOException | RuntimeException e) {
            installer.abandonSession(id);
            throw e;
        }
    }

    /** Android's answers about a session: the dialog to show the player, and how it ended. */
    private synchronized void listenForInstallResults() {
        if (installResults != null) return;
        installResults = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                JSObject event = new JSObject();
                if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent.class);
                    if (confirm == null) {
                        event.put("status", "failure");
                        message = "No confirmation dialog";
                    } else {
                        // From the activity in front, so Android lets the dialog open.
                        Activity activity = getActivity();
                        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        try {
                            if (activity != null) activity.startActivity(confirm);
                            else getContext().startActivity(confirm);
                            event.put("status", "confirm");
                        } catch (Exception e) {
                            event.put("status", "failure");
                            message = "The confirmation dialog did not open: " + e.getMessage();
                        }
                    }
                } else if (status == PackageInstaller.STATUS_SUCCESS) {
                    event.put("status", "success");
                } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
                    event.put("status", "aborted");
                } else {
                    event.put("status", "failure");
                }
                String text = message == null ? "" : message;
                event.put("message", text.length() > 200 ? text.substring(0, 200) : text);
                notifyListeners("install", event);
            }
        };
        ContextCompat.registerReceiver(getContext(), installResults, new IntentFilter(resultAction()), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    /** The old way: opens the APK with the installer, which tells nothing back. */
    private void installWithIntent(File apk) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity activity = getActivity();
        if (activity != null) activity.startActivity(intent);
        else getContext().startActivity(intent);
    }

    @Override
    protected void handleOnDestroy() {
        if (installResults != null) {
            try {
                getContext().unregisterReceiver(installResults);
            } catch (IllegalArgumentException ignored) {}
            installResults = null;
        }
    }

    private long downloadedBuild() {
        File apk = apkFile();
        if (!apk.exists()) return -1;
        PackageInfo archive = getContext().getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
        if (archive == null || !getContext().getPackageName().equals(archive.packageName)) return -1;
        return Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
    }

    private File apkFile() {
        return new File(updatesDir(), "spark-hunt.apk");
    }

    private File partFile(int build) {
        return new File(updatesDir(), "spark-hunt-" + build + ".part");
    }

    /** Parts of other builds are of no use any more. */
    private void forgetOtherParts(int build) {
        File[] files = updatesDir().listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.getName().endsWith(".part") && !file.equals(partFile(build))) file.delete();
        }
    }

    private File updatesDir() {
        return new File(getContext().getCacheDir(), "updates");
    }

    /** A connection that follows GitHub's redirects to its download host, over HTTPS only. */
    private static HttpURLConnection open(String url) throws IOException {
        return open(url, 0);
    }

    /**
     * The same, asking only for the bytes from `from` on: the answer is then either those bytes
     * (206) or, where the server will not, the whole file (200).
     */
    private static HttpURLConnection open(String url, long from) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        if (from > 0) connection.setRequestProperty("Range", "bytes=" + from + "-");
        int status = connection.getResponseCode();
        boolean partial = from > 0 && status == HttpURLConnection.HTTP_PARTIAL;
        if (status != HttpURLConnection.HTTP_OK && !partial) throw new IOException("HTTP " + status);
        if (!"https".equals(connection.getURL().getProtocol())) throw new IOException("Not HTTPS");
        return connection;
    }
}
