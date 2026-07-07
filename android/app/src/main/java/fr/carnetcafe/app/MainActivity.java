package fr.carnetcafe.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
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

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private Uri cameraOutputUri;

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
                openPicker(params.isCaptureEnabled());
                return true;
            }
        });

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

    /** Ouvre l'appareil photo (bouton « Prendre une photo ») ou la galerie. */
    private void openPicker(boolean capture) {
        ArrayList<Intent> extras = new ArrayList<>();
        Intent camera = null;
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

        Intent gallery = new Intent(Intent.ACTION_GET_CONTENT);
        gallery.addCategory(Intent.CATEGORY_OPENABLE);
        gallery.setType("image/*");

        Intent chooser;
        if (capture && camera != null) {
            chooser = camera; // bouton « Prendre une photo » : caméra directe
        } else {
            chooser = Intent.createChooser(gallery, "Photo du paquet");
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

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
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
