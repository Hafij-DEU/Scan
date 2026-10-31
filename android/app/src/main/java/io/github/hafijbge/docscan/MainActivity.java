package io.github.hafijbge.docscan;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.util.Arrays;

/**
 * Hosts the web app (src/, built into assets/www) in a WebView served from
 * https://appassets.androidplatform.net so the page is a secure context
 * (camera access, IndexedDB). Native pieces: camera permission, the file
 * chooser for imports, Host for saving and sharing exports, and the back button.
 */
public class MainActivity extends Activity {

    private static final String TAG = "DocScan";
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/www/index.html";
    private static final int REQ_CAMERA = 1;
    private static final int REQ_FILES = 2;
    private static final int REQ_FOLDER = 3;

    private WebView webView;
    private View topInset;
    private View bottomInset;
    private PermissionRequest pendingPermission;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        topInset = new View(this);
        bottomInset = new View(this);
        topInset.setBackgroundColor(Color.parseColor("#0F766E"));
        bottomInset.setBackgroundColor(Color.parseColor("#0B0F12"));
        webView = new WebView(this);
        root.addView(topInset, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0));
        root.addView(webView, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(bottomInset, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0));
        setContentView(root);
        setupEdgeToEdge(root);
        setupWebView();
        webView.loadUrl(START_URL);
    }

    /** System bars are drawn over spacer views sized from the window insets (edge-to-edge is enforced on API 35). */
    private void setupEdgeToEdge(LinearLayout root) {
        // Android 10 keeps its own system bars; setBars colours them instead.
        if (Build.VERSION.SDK_INT < 30) return;
        Window window = getWindow();
        window.setDecorFitsSystemWindows(false);
        window.setNavigationBarContrastEnforced(false);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsets.Type.ime());
            topInset.getLayoutParams().height = bars.top;
            bottomInset.getLayoutParams().height = Math.max(bars.bottom, ime.bottom);
            view.setPadding(bars.left, 0, bars.right, 0);
            topInset.requestLayout();
            bottomInset.requestLayout();
            return WindowInsets.CONSUMED;
        });
    }

    private void setupWebView() {
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);
        // The camera stream is a muted <video> that must autoplay.
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        webView.addJavascriptInterface(new Host(this), "DocScanHost");

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // The app never leaves its own origin; web links open in the browser.
                if (HOST.equals(request.getUrl().getHost())) return false;
                if ("https".equals(request.getUrl().getScheme())) {
                    try {
                        startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, request.getUrl()));
                    } catch (RuntimeException ignored) {
                        // no browser
                    }
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> handlePermission(request));
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingPermission == request) pendingPermission = null;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = params.createIntent();
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(intent, REQ_FILES);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                Log.d(TAG, message.message() + " (" + message.sourceId() + ":" + message.lineNumber() + ")");
                return true;
            }
        });
    }

    /** Grants only video capture, asking for the CAMERA runtime permission first when needed. */
    private void handlePermission(PermissionRequest request) {
        if (!Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
            return;
        }
        if (pendingPermission != null) pendingPermission.deny();
        pendingPermission = request;
        requestPermissions(new String[] { Manifest.permission.CAMERA }, REQ_CAMERA);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode != REQ_CAMERA || pendingPermission == null) {
            super.onRequestPermissionsResult(requestCode, permissions, results);
            return;
        }
        PermissionRequest request = pendingPermission;
        pendingPermission = null;
        if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
        } else {
            request.deny();
        }
    }

    /** Opens the system folder picker, starting at Documents/DocScan. */
    void pickFolder() {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
            .putExtra(android.provider.DocumentsContract.EXTRA_INITIAL_URI,
                Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADocuments%2FDocScan"))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        try {
            startActivityForResult(intent, REQ_FOLDER);
        } catch (ActivityNotFoundException e) {
            callJs("__docscanFolderPicked", null);
        }
    }

    private void folderPicked(int resultCode, Intent data) {
        Uri tree = resultCode == RESULT_OK && data != null ? data.getData() : null;
        if (tree == null) {
            callJs("__docscanFolderPicked", null);
            return;
        }
        try {
            getContentResolver().takePersistableUriPermission(tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException e) {
            toastError("Cannot keep access to that folder");
            callJs("__docscanFolderPicked", null);
            return;
        }
        getSharedPreferences(Host.PREFS, 0).edit().putString(Host.KEY_TREE, tree.toString()).apply();
        String label = new Host(this).folderLabel();
        callJs("__docscanFolderPicked", label.startsWith("ok:") ? label.substring(3) : "");
    }

    /** Hands the Google sign-in redirect (or null) to the page. */
    void deliverOAuth(String query) {
        runOnUiThread(() -> callJs("__docscanOAuth", query));
    }

    void toastError(String message) {
        runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show());
    }

    /** Matches the status and navigation bar strips to the page colours. */
    void setBars(String top, String bottom, boolean lightBottom) {
        int topColor;
        int bottomColor;
        try {
            topColor = Color.parseColor(top);
            bottomColor = Color.parseColor(bottom);
        } catch (IllegalArgumentException ignored) {
            return;
        }
        topInset.setBackgroundColor(topColor);
        bottomInset.setBackgroundColor(bottomColor);
        if (Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                int nav = android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(lightBottom ? nav : 0, nav);
            }
        } else {
            getWindow().setStatusBarColor(topColor);
            getWindow().setNavigationBarColor(bottomColor);
            View decor = getWindow().getDecorView();
            int flags = decor.getSystemUiVisibility();
            flags = lightBottom ? flags | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : flags & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            decor.setSystemUiVisibility(flags);
        }
    }

    /** Calls window[fn](arg) with a JSON-quoted string argument (or null). */
    private void callJs(String fn, String arg) {
        String value = arg == null ? "null" : JSONObject.quote(arg);
        webView.evaluateJavascript("window." + fn + " && window." + fn + "(" + value + ")", null);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FOLDER) {
            folderPicked(resultCode, data);
            return;
        }
        if (requestCode != REQ_FILES) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < result.length; i++) result[i] = clip.getItemAt(i).getUri();
            } else {
                result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        webView.evaluateJavascript("window.__docscanBack ? window.__docscanBack() : false", value -> {
            if (!"true".equals(value)) super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
