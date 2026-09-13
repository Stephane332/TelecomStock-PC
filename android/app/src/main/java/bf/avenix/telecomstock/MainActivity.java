package bf.avenix.telecomstock;

import android.annotation.SuppressLint;
import android.app.AlertDialog;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
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
 * TelecomStock Pro — application Android.
 *
 * Deux façons de travailler, choisies par le commerçant au premier lancement :
 *
 *  • AUTONOME — l'interface est embarquée dans l'application et les données
 *    sont conservées dans le téléphone. Aucun ordinateur, aucun réseau requis.
 *    C'est le mode d'une boutique qui ne possède qu'un téléphone.
 *
 *  • CONNECTÉ — l'interface est servie par le poste de caisse sur le Wi-Fi de
 *    la boutique. Le téléphone et le PC partagent alors les mêmes données.
 *
 * Le choix est modifiable à tout moment et mémorisé.
 */
public class MainActivity extends AppCompatActivity {

    private static final String PREFS = "telecomstock";
    private static final String KEY_URL = "server_url";
    private static final String KEY_MODE = "mode";          // "autonome" | "connecte"
    private static final String MODE_AUTONOME = "autonome";
    private static final String MODE_CONNECTE = "connecte";

    /** Interface embarquée : servie depuis les assets de l'application. */
    private static final String URL_LOCALE = "file:///android_asset/www/index.html";

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
        s.setDomStorageEnabled(true);          // localStorage : données du mode autonome
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Autorise la page embarquée à charger ses propres fichiers (CSS, JS).
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                // En mode autonome tout est local : une erreur réseau ne doit
                // jamais faire basculer sur l'écran « poste injoignable ».
                if (req.isForMainFrame() && !isAutonome()) showConnectionError();
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

        String mode = prefs.getString(KEY_MODE, null);
        if (mode == null) {
            askMode();                       // premier lancement : on laisse choisir
        } else if (MODE_AUTONOME.equals(mode)) {
            startAutonome();
        } else {
            String url = prefs.getString(KEY_URL, null);
            if (url == null) askServerUrl(false);
            else webView.loadUrl(url);
        }
    }

    private boolean isAutonome() {
        return MODE_AUTONOME.equals(prefs.getString(KEY_MODE, ""));
    }

    /** Premier lancement : le commerçant choisit comment il veut travailler. */
    private void askMode() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setGravity(Gravity.CENTER);
        layout.setBackgroundColor(Color.parseColor("#F3F4F6"));
        layout.setPadding(56, 56, 56, 56);

        TextView title = new TextView(this);
        title.setText("TelecomStock Pro");
        title.setTextSize(22);
        title.setTextColor(Color.parseColor("#111827"));
        title.setGravity(Gravity.CENTER);

        TextView question = new TextView(this);
        question.setText("Comment souhaitez-vous utiliser l'application ?");
        question.setTextSize(15);
        question.setTextColor(Color.parseColor("#4B5563"));
        question.setGravity(Gravity.CENTER);
        question.setPadding(0, 28, 0, 36);

        Button seul = new Button(this);
        seul.setText("Sur ce téléphone uniquement");
        seul.setOnClickListener(v -> {
            prefs.edit().putString(KEY_MODE, MODE_AUTONOME).apply();
            startAutonome();
        });

        TextView seulAide = new TextView(this);
        seulAide.setText("Aucun ordinateur nécessaire.\nVos données restent dans ce téléphone.");
        seulAide.setTextSize(12);
        seulAide.setTextColor(Color.parseColor("#6B7280"));
        seulAide.setGravity(Gravity.CENTER);
        seulAide.setPadding(0, 8, 0, 28);

        Button caisse = new Button(this);
        caisse.setText("Me connecter à l'ordinateur de la caisse");
        caisse.setOnClickListener(v -> {
            prefs.edit().putString(KEY_MODE, MODE_CONNECTE).apply();
            setContentView(webView);
            askServerUrl(false);
        });

        TextView caisseAide = new TextView(this);
        caisseAide.setText("Les données sont partagées avec le poste de caisse.\nLe PC doit être allumé et sur le même Wi-Fi.");
        caisseAide.setTextSize(12);
        caisseAide.setTextColor(Color.parseColor("#6B7280"));
        caisseAide.setGravity(Gravity.CENTER);
        caisseAide.setPadding(0, 8, 0, 0);

        layout.addView(title);
        layout.addView(question);
        layout.addView(seul);
        layout.addView(seulAide);
        layout.addView(caisse);
        layout.addView(caisseAide);
        setContentView(layout);
    }

    /** Charge l'interface embarquée et force le stockage local côté web. */
    private void startAutonome() {
        setContentView(webView);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                // L'interface partage le même code que le PC : on lui indique
                // simplement qu'elle doit travailler sans serveur.
                view.evaluateJavascript(
                        "localStorage.setItem('telecomstock_mode','autonome');", null);
            }
        });
        webView.loadUrl(URL_LOCALE);
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
                .setNeutralButton("Utiliser sans ordinateur", (d, w) -> {
                    prefs.edit().putString(KEY_MODE, MODE_AUTONOME).apply();
                    startAutonome();
                })
                .show();
    }

    /** Écran d'erreur : réessayer, corriger l'adresse, ou basculer en autonome. */
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
            askServerUrl(false);
        });

        Button autonome = new Button(this);
        autonome.setText("Travailler sans ordinateur");
        autonome.setOnClickListener(v -> {
            prefs.edit().putString(KEY_MODE, MODE_AUTONOME).apply();
            startAutonome();
        });

        layout.addView(title);
        layout.addView(hint);
        layout.addView(retry);
        layout.addView(change);
        layout.addView(autonome);
        setContentView(layout);
    }
}
