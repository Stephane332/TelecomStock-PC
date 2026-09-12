package bf.avenix.telecomstock;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

/**
 * TelecomStock Pro — client Android.
 *
 * L'application affiche l'interface servie par le poste de caisse
 * (le PC qui fait tourner TelecomStock) sur le réseau local de la boutique.
 * L'adresse est demandée au premier lancement puis mémorisée.
 */
public class MainActivity extends AppCompatActivity {

    private static final String PREFS = "telecomstock";
    private static final String KEY_URL = "server_url";

    private WebView webView;
    private SharedPreferences prefs;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage : conservation du jeton
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showConnectionError();
            }
        });

        setContentView(webView);

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack();
                else finish();
            }
        });

        String url = prefs.getString(KEY_URL, null);
        if (url == null) askServerUrl(false);
        else webView.loadUrl(url);
    }

    /** Demande l'adresse du poste de caisse (ex. http://192.168.1.10:3002). */
    private void askServerUrl(final boolean isRetry) {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("http://192.168.1.10:3002");
        input.setText(prefs.getString(KEY_URL, "http://192.168.1.10:3002"));

        new AlertDialog.Builder(this)
                .setTitle("Adresse du poste de caisse")
                .setMessage("Saisissez l'adresse affichée par TelecomStock Pro sur l'ordinateur de la boutique.")
                .setView(input)
                .setCancelable(!isRetry)
                .setPositiveButton("Connexion", (d, w) -> {
                    String url = input.getText().toString().trim();
                    if (url.isEmpty()) { askServerUrl(true); return; }
                    if (!url.startsWith("http://") && !url.startsWith("https://")) url = "http://" + url;
                    prefs.edit().putString(KEY_URL, url).apply();
                    webView.loadUrl(url);
                })
                .show();
    }

    /** Écran d'erreur avec possibilité de réessayer ou de corriger l'adresse. */
    private void showConnectionError() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setBackgroundColor(Color.parseColor("#F3F4F6"));
        layout.setPadding(48, 48, 48, 48);

        TextView title = new TextView(this);
        title.setText("Poste de caisse injoignable");
        title.setTextSize(19);
        title.setTextColor(Color.parseColor("#111827"));
        title.setGravity(Gravity.CENTER);

        TextView hint = new TextView(this);
        hint.setText("Vérifiez que :\n\n• l'ordinateur de la boutique est allumé\n"
                + "• TelecomStock Pro y est lancé\n"
                + "• le téléphone est sur le même réseau Wi-Fi\n\n"
                + "Adresse : " + prefs.getString(KEY_URL, "(non définie)"));
        hint.setTextSize(14);
        hint.setTextColor(Color.parseColor("#4B5563"));
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(0, 32, 0, 40);

        Button retry = new Button(this);
        retry.setText("Réessayer");
        retry.setOnClickListener(v -> {
            setContentView(webView);
            webView.loadUrl(prefs.getString(KEY_URL, ""));
        });

        Button change = new Button(this);
        change.setText("Modifier l'adresse");
        change.setOnClickListener(v -> {
            setContentView(webView);
            askServerUrl(true);
        });

        layout.addView(title);
        layout.addView(hint);
        layout.addView(retry);
        layout.addView(change);

        View parent = webView.getParent() == null ? null : webView;
        if (parent != null && webView.getParent() instanceof android.view.ViewGroup) {
            ((android.view.ViewGroup) webView.getParent()).removeView(webView);
        }
        setContentView(layout);
    }
}
