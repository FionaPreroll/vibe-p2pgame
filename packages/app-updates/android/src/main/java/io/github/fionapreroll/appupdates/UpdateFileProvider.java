package io.github.fionapreroll.appupdates;

import androidx.core.content.FileProvider;

/**
 * Shares the downloaded APK with Android's installer, where an installer session cannot be made
 * (AppUpdaterPlugin.installWithIntent). A class of its own, so it does not clash with a
 * FileProvider of the app.
 */
public class UpdateFileProvider extends FileProvider {

    /** Its authority, after the app's id. */
    static final String SUFFIX = ".appupdates.fileprovider";
}
