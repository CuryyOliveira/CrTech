package br.com.conferenciarapida.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.WebViewListener;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.json.JSONObject;

/**
 * Casca Android do Conferência Rápida.
 *
 * O sistema continua sendo servido pelo servidor publicado (ver capacitor.config.json); aqui ficam só
 * as adaptações que o WebView do Android precisa para ter o mesmo comportamento do navegador:
 * downloads de arquivos gerados no navegador, impressão, câmera nos campos de foto, links externos
 * e o botão "voltar".
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "ConferenciaRapida";
    private static final String CANAL = "CRNativo";

    /**
     * Endereço do sistema publicado, carregado diretamente pelo WebView (rede nativa do Chromium).
     * Usa o endereço publicado pela Lovable, que não depende do DNS do domínio próprio.
     */
    static final String APP_URL = "https://conferenciamat.lovable.app/";

    /** Origens do sistema autorizadas a usar o canal nativo. */
    private static final Set<String> ORIGENS = new HashSet<>(
        Arrays.asList("https://conferenciarapida.com.br", "https://www.conferenciarapida.com.br", "https://conferenciamat.lovable.app")
    );

    private String scriptAdaptacoes;

    private ActivityResultLauncher<Intent> seletorLauncher;
    private ActivityResultLauncher<String> cameraPermissaoLauncher;
    private ValueCallback<Uri[]> seletorCallback;
    private Uri fotoCameraUri;
    private Runnable aposPermissaoCamera;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (bridge == null) return;

        WebView webView = bridge.getWebView();
        scriptAdaptacoes = lerAsset("cr-android.js");

        registrarLaunchers();
        configurarCanalNativo(webView);
        bridge.setWebViewClient(new WebClient(bridge));
        webView.setWebChromeClient(new ChromeClient(bridge));
        webView.setDownloadListener(this::baixarUrl);
        configurarBotaoVoltar(webView);

        webView.loadUrl(APP_URL);
    }

    // ------------------------------------------------------------------ carregamento e tela offline

    /**
     * Mostra a tela "sem conexão" apenas quando a página principal não pôde ser carregada por falha de
     * rede (DNS, conexão, SSL, tempo esgotado). Respostas HTTP de erro são exibidas pelo próprio sistema.
     */
    private class WebClient extends BridgeWebViewClient {

        WebClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            super.onReceivedError(view, request, error);
            if (!request.isForMainFrame() || !origemDoSistema(request.getUrl().toString())) return;
            Log.w(TAG, "Falha ao abrir " + request.getUrl() + ": " + error.getErrorCode() + " " + error.getDescription());
            Uri offline = Uri.parse(bridge.getLocalUrl() + "/offline.html")
                .buildUpon()
                .appendQueryParameter("url", request.getUrl().toString())
                .appendQueryParameter("erro", error.getErrorCode() + " " + error.getDescription())
                .build();
            view.loadUrl(offline.toString());
        }
    }

    // ------------------------------------------------------------------ canal JS <-> Android

    @SuppressLint({ "RequiresFeature", "JavascriptInterface" })
    private void configurarCanalNativo(WebView webView) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            // Restrito às origens do sistema: páginas externas (pagamento, login) não enxergam o canal.
            WebViewCompat.addWebMessageListener(webView, CANAL, ORIGENS, (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                if (isMainFrame && message.getData() != null) tratarMensagem(message.getData());
            });
        } else {
            webView.addJavascriptInterface(new CanalLegado(), CANAL);
        }

        if (scriptAdaptacoes != null && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, scriptAdaptacoes, ORIGENS);
        }

        // Reforço: injeta também ao terminar de carregar (WebViews antigos ou sem DOCUMENT_START_SCRIPT).
        bridge.addWebViewListener(
            new WebViewListener() {
                @Override
                public void onPageLoaded(WebView view) {
                    if (scriptAdaptacoes == null || !origemDoSistema(view.getUrl())) return;
                    view.evaluateJavascript(scriptAdaptacoes, null);
                }
            }
        );
    }

    /** Usado apenas em WebViews sem WEB_MESSAGE_LISTENER; valida a origem da página atual. */
    private class CanalLegado {

        @JavascriptInterface
        public void postMessage(String dados) {
            runOnUiThread(() -> {
                if (bridge != null && origemDoSistema(bridge.getWebView().getUrl())) tratarMensagem(dados);
            });
        }
    }

    private static boolean origemDoSistema(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        if (uri.getScheme() == null || uri.getHost() == null) return false;
        return ORIGENS.contains(uri.getScheme() + "://" + uri.getHost());
    }

    private void tratarMensagem(String json) {
        try {
            JSONObject msg = new JSONObject(json);
            switch (msg.optString("tipo")) {
                case "arquivo":
                    salvarArquivo(msg.getString("nome"), msg.optString("mime", "application/octet-stream"), msg.getString("dados"));
                    break;
                case "imprimirHtml":
                    imprimirHtml(msg.getString("html"), msg.optString("titulo"));
                    break;
                case "imprimirPagina":
                    imprimirWebView(bridge.getWebView(), msg.optString("titulo"));
                    break;
                case "externo":
                    abrirExterno(msg.getString("url"));
                    break;
                case "erro":
                    aviso(msg.optString("mensagem", "Ocorreu um erro."));
                    break;
                default:
                    break;
            }
        } catch (Exception e) {
            Log.e(TAG, "Mensagem inválida do WebView", e);
        }
    }

    // ------------------------------------------------------------------ arquivos (PDF, Excel, CSV...)

    private void salvarArquivo(String nome, String mime, String base64) {
        final byte[] bytes;
        try {
            bytes = Base64.decode(base64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            aviso("Não foi possível salvar o arquivo.");
            return;
        }
        final String tipo = normalizarMime(nome, mime);
        new Thread(() -> {
            try {
                Uri uri = gravarEmDownloads(nome, tipo, bytes);
                runOnUiThread(() -> {
                    aviso("Arquivo salvo em Downloads: " + nome);
                    abrirArquivo(uri, tipo);
                });
            } catch (Exception e) {
                Log.e(TAG, "Falha ao salvar " + nome, e);
                runOnUiThread(() -> aviso("Não foi possível salvar o arquivo."));
            }
        })
            .start();
    }

    private Uri gravarEmDownloads(String nome, String mime, byte[] bytes) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues valores = new ContentValues();
            valores.put(MediaStore.MediaColumns.DISPLAY_NAME, nome);
            valores.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            valores.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            valores.put(MediaStore.MediaColumns.IS_PENDING, 1);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, valores);
            if (uri == null) throw new IllegalStateException("MediaStore recusou o arquivo");
            try (OutputStream saida = getContentResolver().openOutputStream(uri)) {
                if (saida == null) throw new IllegalStateException("Sem acesso ao arquivo");
                saida.write(bytes);
            }
            valores.clear();
            valores.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContentResolver().update(uri, valores, null, null);
            return uri;
        }
        // Android 9 ou anterior: pasta do app (não exige permissão de armazenamento).
        File pasta = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (pasta == null) pasta = new File(getFilesDir(), "downloads");
        if (!pasta.exists() && !pasta.mkdirs()) throw new IllegalStateException("Sem pasta de downloads");
        File destino = new File(pasta, nome);
        try (OutputStream saida = new FileOutputStream(destino)) {
            saida.write(bytes);
        }
        return FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", destino);
    }

    private void abrirArquivo(Uri uri, String mime) {
        Intent abrir = new Intent(Intent.ACTION_VIEW);
        abrir.setDataAndType(uri, mime);
        abrir.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(Intent.createChooser(abrir, "Abrir arquivo"));
        } catch (ActivityNotFoundException e) {
            // Sem app para abrir: o arquivo continua em Downloads.
        }
    }

    private static String normalizarMime(String nome, String mime) {
        String base = mime == null ? "" : mime.split(";")[0].trim();
        if (!base.isEmpty() && !"application/octet-stream".equals(base)) return base;
        int ponto = nome.lastIndexOf('.');
        if (ponto >= 0) {
            String porExtensao = MimeTypeMap.getSingleton().getMimeTypeFromExtension(nome.substring(ponto + 1).toLowerCase());
            if (porExtensao != null) return porExtensao;
        }
        return "application/octet-stream";
    }

    /** Downloads comuns por URL http(s) (ex.: anexos servidos pelo sistema). */
    private void baixarUrl(String url, String userAgent, String contentDisposition, String mimetype, long tamanho) {
        if (url == null || !(url.startsWith("http://") || url.startsWith("https://"))) return;
        try {
            String nome = URLUtil.guessFileName(url, contentDisposition, mimetype);
            DownloadManager.Request pedido = new DownloadManager.Request(Uri.parse(url));
            pedido.setMimeType(mimetype);
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) pedido.addRequestHeader("Cookie", cookies);
            pedido.addRequestHeader("User-Agent", userAgent);
            pedido.setTitle(nome);
            pedido.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                pedido.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nome);
            } else {
                pedido.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, nome);
            }
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            dm.enqueue(pedido);
            aviso("Baixando " + nome);
        } catch (Exception e) {
            Log.e(TAG, "Falha no download", e);
            abrirExterno(url);
        }
    }

    // ------------------------------------------------------------------ impressão

    private WebView webViewImpressao;

    private void imprimirHtml(String html, String titulo) {
        WebView wv = new WebView(this);
        wv.getSettings().setJavaScriptEnabled(false);
        wv.setWebViewClient(
            new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return true;
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    imprimirWebView(view, titulo);
                    webViewImpressao = null;
                }
            }
        );
        webViewImpressao = wv; // mantém a referência até a impressão começar
        wv.loadDataWithBaseURL(APP_URL, html, "text/html", "UTF-8", null);
    }

    private void imprimirWebView(WebView wv, String titulo) {
        PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
        if (pm == null) {
            aviso("Impressão indisponível neste aparelho.");
            return;
        }
        String nome = (titulo == null || titulo.trim().isEmpty()) ? "Conferência Rápida" : titulo.trim();
        PrintDocumentAdapter adapter = wv.createPrintDocumentAdapter(nome);
        pm.print(nome, adapter, new PrintAttributes.Builder().build());
    }

    // ------------------------------------------------------------------ links externos

    private void abrirExterno(String url) {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            aviso("Nenhum aplicativo para abrir o link.");
        }
    }

    // ------------------------------------------------------------------ fotos (câmera ou galeria)

    private void registrarLaunchers() {
        seletorLauncher = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), resultado -> {
            ValueCallback<Uri[]> callback = seletorCallback;
            seletorCallback = null;
            if (callback == null) return;
            Uri[] uris = null;
            if (resultado.getResultCode() == Activity.RESULT_OK) {
                Intent dados = resultado.getData();
                if (dados != null && dados.getClipData() != null) {
                    int n = dados.getClipData().getItemCount();
                    uris = new Uri[n];
                    for (int i = 0; i < n; i++) uris[i] = dados.getClipData().getItemAt(i).getUri();
                } else if (dados != null && dados.getData() != null) {
                    uris = new Uri[] { dados.getData() };
                } else if (fotoCameraUri != null && fotoFoiGravada(fotoCameraUri)) {
                    uris = new Uri[] { fotoCameraUri };
                }
            }
            fotoCameraUri = null;
            callback.onReceiveValue(uris);
        });
        cameraPermissaoLauncher = registerForActivityResult(new ActivityResultContracts.RequestPermission(), concedida -> {
            Runnable r = aposPermissaoCamera;
            aposPermissaoCamera = null;
            if (r != null) r.run();
        });
    }

    private boolean fotoFoiGravada(Uri uri) {
        try (InputStream in = getContentResolver().openInputStream(uri)) {
            return in != null && in.read() != -1;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Nos campos de imagem, oferece câmera e galeria (como o Chrome faz no celular). Os demais campos
     * (planilhas, JSON) continuam com o seletor padrão do Capacitor.
     */
    private class ChromeClient extends BridgeWebChromeClient {

        ChromeClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (!aceitaImagem(params)) return super.onShowFileChooser(webView, callback, params);

            if (seletorCallback != null) seletorCallback.onReceiveValue(null);
            seletorCallback = callback;

            boolean temPermissao =
                ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
            if (temPermissao) {
                abrirSeletorDeImagem(params, true);
            } else {
                aposPermissaoCamera = () ->
                    abrirSeletorDeImagem(
                        params,
                        ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.CAMERA) ==
                        PackageManager.PERMISSION_GRANTED
                    );
                cameraPermissaoLauncher.launch(Manifest.permission.CAMERA);
            }
            return true;
        }
    }

    private static boolean aceitaImagem(WebChromeClient.FileChooserParams params) {
        String[] tipos = params.getAcceptTypes();
        if (tipos == null) return false;
        for (String t : tipos) {
            if (t != null && t.trim().startsWith("image/")) return true;
        }
        return false;
    }

    private void abrirSeletorDeImagem(WebChromeClient.FileChooserParams params, boolean comCamera) {
        Intent galeria = new Intent(Intent.ACTION_GET_CONTENT);
        galeria.addCategory(Intent.CATEGORY_OPENABLE);
        galeria.setType("image/*");
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            galeria.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }

        List<Intent> extras = new ArrayList<>();
        fotoCameraUri = null;
        if (comCamera) {
            try {
                File pasta = new File(getCacheDir(), "fotos");
                if (!pasta.exists()) pasta.mkdirs();
                File foto = File.createTempFile("foto-", ".jpg", pasta);
                fotoCameraUri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", foto);
                Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                camera.putExtra(MediaStore.EXTRA_OUTPUT, fotoCameraUri);
                camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                extras.add(camera);
            } catch (Exception e) {
                Log.w(TAG, "Câmera indisponível", e);
                fotoCameraUri = null;
            }
        }

        Intent escolher = Intent.createChooser(galeria, "Selecionar foto");
        if (!extras.isEmpty()) escolher.putExtra(Intent.EXTRA_INITIAL_INTENTS, extras.toArray(new Intent[0]));
        try {
            seletorLauncher.launch(escolher);
        } catch (ActivityNotFoundException e) {
            if (seletorCallback != null) seletorCallback.onReceiveValue(null);
            seletorCallback = null;
        }
    }

    // ------------------------------------------------------------------ botão voltar

    private void configurarBotaoVoltar(WebView webView) {
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        if (webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            moveTaskToBack(true);
                        }
                    }
                }
            );
    }

    // ------------------------------------------------------------------ utilitários

    private void aviso(String texto) {
        Toast.makeText(this, texto, Toast.LENGTH_LONG).show();
    }

    private String lerAsset(String nome) {
        try (InputStream in = getAssets().open(nome)) {
            byte[] buffer = new byte[in.available()];
            int lidos = 0;
            while (lidos < buffer.length) {
                int n = in.read(buffer, lidos, buffer.length - lidos);
                if (n < 0) break;
                lidos += n;
            }
            return new String(buffer, 0, lidos, StandardCharsets.UTF_8);
        } catch (Exception e) {
            Log.e(TAG, "Script de adaptações não encontrado", e);
            return null;
        }
    }
}
