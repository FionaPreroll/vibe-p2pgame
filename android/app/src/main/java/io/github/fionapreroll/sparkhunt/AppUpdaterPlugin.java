package io.github.fionapreroll.sparkhunt;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Updates the app from its GitHub release, for src/updates.ts: reads the installed build number,
 * reads the release's version.json, downloads the new APK and hands it to Android's package
 * installer. The installer asks the player, and takes the APK only if it is signed with the same
 * key as the app installed.
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    /** Only the game's own releases are read, and followed where GitHub redirects them. */
    private static final String RELEASES = "https://github.com/FionaPreroll/vibe-p2pgame/releases/";
    private static final long MAX_APK_BYTES = 200L * 1024 * 1024;
    private static final int MAX_TEXT_BYTES = 64 * 1024;

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

    /** Downloads an APK from the releases into the app's cache, telling its progress. */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith(RELEASES)) {
            call.reject("Not a release of this game");
            return;
        }
        execute(() -> {
            HttpURLConnection connection = null;
            File apk = apkFile();
            try {
                apk.getParentFile().mkdirs();
                connection = open(url);
                long total = connection.getContentLengthLong();
                if (total > MAX_APK_BYTES) throw new IOException("Too large");
                try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[64 * 1024];
                    long done = 0;
                    int read;
                    int shown = -1;
                    while ((read = in.read(buffer)) != -1) {
                        done += read;
                        if (done > MAX_APK_BYTES) throw new IOException("Too large");
                        out.write(buffer, 0, read);
                        int percent = total > 0 ? (int) (done * 100 / total) : -1;
                        if (percent != shown) {
                            shown = percent;
                            JSObject progress = new JSObject();
                            progress.put("percent", percent);
                            notifyListeners("progress", progress);
                        }
                    }
                }
                call.resolve();
            } catch (Exception e) {
                apk.delete();
                call.reject("Download failed", e);
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
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
     * taps Install again.
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
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private long downloadedBuild() {
        File apk = apkFile();
        if (!apk.exists()) return -1;
        PackageInfo archive = getContext().getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
        if (archive == null || !getContext().getPackageName().equals(archive.packageName)) return -1;
        return Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
    }

    private File apkFile() {
        return new File(new File(getContext().getCacheDir(), "updates"), "spark-hunt.apk");
    }

    /** A connection that follows GitHub's redirects to its download host, over HTTPS only. */
    private static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        int status = connection.getResponseCode();
        if (status != HttpURLConnection.HTTP_OK) throw new IOException("HTTP " + status);
        if (!"https".equals(connection.getURL().getProtocol())) throw new IOException("Not HTTPS");
        return connection;
    }
}
