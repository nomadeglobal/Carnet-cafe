package fr.carnetcafe.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

/**
 * Carnet Café — enveloppe native de l'application web.
 * Les fichiers web (assets/www) sont servis sur une origine HTTPS
 * virtuelle (https://carnetcafe.app) afin qu'IndexedDB et les autres
 * API « secure context » fonctionnent normalement.
 */
public class MainActivity extends Activity {

    private static final String VIRTUAL_HOST = "carnetcafe.app";
    private static final int REQ_FILE_CHOOSER = 1;
    private static final int REQ_SAVE_BACKUP = 2;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraOutputUri;
    private String pendingBackupJson;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (VIRTUAL_HOST.equals(url.getHost())) {
                    return serveAsset(url.getPath());
                }
                return null; // réseau normal (proxys d'analyse, polices…)
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                if (VIRTUAL_HOST.equals(url.getHost())) return false;
                // Liens externes (site du torréfacteur…) : navigateur du téléphone
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignored) { }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                // L'import de sauvegarde (accept=.json) doit ouvrir le
                // sélecteur de fichiers général, pas la galerie photos.
                boolean imageOnly = true;
                for (String a : params.getAcceptTypes()) {
                    if (a != null && !a.isEmpty() && !a.startsWith("image")) imageOnly = false;
                }
                openPicker(params.isCaptureEnabled(), imageOnly);
                return true;
            }
        });

        // Pont JS : l'export de sauvegarde passe par le sélecteur natif
        // Android (mémoire interne, carte SD, Google Drive…).
        webView.addJavascriptInterface(new BackupBridge(), "CarnetAndroid");

        if (savedInstanceState == null) {
            webView.loadUrl("https://" + VIRTUAL_HOST + "/index.html");
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    /** Sert un fichier du dossier assets/www avec le bon type MIME. */
    private WebResourceResponse serveAsset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        String assetPath = "www" + path;
        try {
            InputStream in = getAssets().open(assetPath);
            return new WebResourceResponse(guessMime(assetPath), "UTF-8", in);
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    null, null);
        }
    }

    private String guessMime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        String ext = MimeTypeMap.getFileExtensionFromUrl(path);
        String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        return mime != null ? mime : "application/octet-stream";
    }

    /** Ouvre l'appareil photo, la galerie, ou le sélecteur de fichiers. */
    private void openPicker(boolean capture, boolean imageOnly) {
        ArrayList<Intent> extras = new ArrayList<>();
        Intent camera = null;
        if (imageOnly) {
            try {
                File dir = new File(getCacheDir(), "camera");
                dir.mkdirs();
                File photo = File.createTempFile("capture_", ".jpg", dir);
                cameraOutputUri = FileProvider.getUriForFile(this,
                        "fr.carnetcafe.app.fileprovider", photo);
                camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutputUri);
                camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            } catch (IOException ignored) {
                cameraOutputUri = null;
            }
        }

        Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
        gallery.addCategory(Intent.CATEGORY_OPENABLE);
        gallery.setType(imageOnly ? "image/*" : "*/*");

        Intent chooser;
        if (capture && camera != null) {
            chooser = camera; // bouton « Prendre une photo » : caméra directe
        } else {
            chooser = Intent.createChooser(gallery, imageOnly ? "Photo du paquet" : "Choisir un fichier");
            if (camera != null) {
                extras.add(camera);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extras.toArray(new Intent[0]));
            }
        }
        try {
            startActivityForResult(chooser, REQ_FILE_CHOOSER);
        } catch (Exception e) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
    }

    /** Pont JavaScript pour la sauvegarde du catalogue. */
    private class BackupBridge {
        @JavascriptInterface
        public void saveBackup(String json, String filename) {
            pendingBackupJson = json;
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/json");
                intent.putExtra(Intent.EXTRA_TITLE, filename);
                try {
                    startActivityForResult(intent, REQ_SAVE_BACKUP);
                } catch (Exception e) {
                    pendingBackupJson = null;
                    notifyBackupSaved(false);
                }
            });
        }
    }

    private void notifyBackupSaved(boolean ok) {
        runOnUiThread(() ->
                webView.evaluateJavascript(
                        "window.onBackupSaved && window.onBackupSaved(" + ok + ")", null));
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_SAVE_BACKUP) {
            boolean ok = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null
                    && pendingBackupJson != null) {
                try (OutputStream os = getContentResolver().openOutputStream(data.getData())) {
                    os.write(pendingBackupJson.getBytes(StandardCharsets.UTF_8));
                    ok = true;
                } catch (IOException ignored) { }
            }
            pendingBackupJson = null;
            notifyBackupSaved(ok);
            return;
        }
        if (requestCode != REQ_FILE_CHOOSER || filePathCallback == null) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getData() != null) {
                result = new Uri[]{ data.getData() };          // galerie
            } else if (cameraOutputUri != null) {
                result = new Uri[]{ cameraOutputUri };          // appareil photo
            }
        }
        filePathCallback.onReceiveValue(result);
        filePathCallback = null;
        cameraOutputUri = null;
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }
}
