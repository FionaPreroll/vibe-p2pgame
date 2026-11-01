package io.github.fionapreroll.sparkhunt;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin, for updates from its GitHub release (see AppUpdaterPlugin).
        registerPlugin(AppUpdaterPlugin.class);
        // Bluetooth between phones comes from @fionapreroll/p2p-nearby, which Capacitor registers.
        super.onCreate(savedInstanceState);
    }
}
