package br.com.conferenciarapida.app;

import java.util.regex.Pattern;

/**
 * Aviso de nova versão: o app só informa a própria versão ao site (domínio oficial) e abre a
 * página oficial da release no navegador. Nada é baixado nem instalado pelo app.
 *
 * O endereço é sempre montado aqui a partir de uma constante; a única parte variável é a versão,
 * aceita somente no formato MAJOR.MINOR.PATCH. Qualquer outro valor abre /releases/latest.
 */
final class Atualizacao {

    static final String URL_RELEASES = "https://github.com/CuryyOliveira/CrTech/releases";
    static final String URL_MAIS_RECENTE = URL_RELEASES + "/latest";

    private static final Pattern VERSAO = Pattern.compile("^(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d{0,3})\\.(0|[1-9]\\d{0,3})$");

    private Atualizacao() {}

    static boolean versaoValida(String versao) {
        return versao != null && VERSAO.matcher(versao).matches();
    }

    /** Página oficial da release (constante + versão validada). */
    static String urlDaRelease(String versao) {
        return versaoValida(versao) ? URL_RELEASES + "/tag/android-v" + versao : URL_MAIS_RECENTE;
    }

    /**
     * Script injetado só nas origens do sistema: expõe a versão instalada ao site, somente leitura.
     * O nome é validado (formato numérico), então não há como injetar código pelo versionName.
     */
    static String scriptVersao(String versionName, int versionCode) {
        String nome = versaoValida(versionName) ? versionName : "";
        return (
            "if(!window.__crVersaoApp){Object.defineProperty(window,'__crVersaoApp',{value:Object.freeze({versionName:'" +
            nome +
            "',versionCode:" +
            Math.max(0, versionCode) +
            "}),writable:false,configurable:false});}\n"
        );
    }
}
