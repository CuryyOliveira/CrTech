package br.com.conferenciarapida.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/** O endereço de atualização só pode ser a página oficial do repositório no GitHub. */
public class AtualizacaoTest {

    private static final String OFICIAL = "https://github.com/CuryyOliveira/CrTech/releases";

    @Test
    public void versaoValidaMontaPaginaDaRelease() {
        assertEquals(OFICIAL + "/tag/android-v2.0.3", Atualizacao.urlDaRelease("2.0.3"));
        assertEquals(OFICIAL + "/tag/android-v2.1.0", Atualizacao.urlDaRelease("2.1.0"));
        assertEquals(OFICIAL + "/tag/android-v10.20.30", Atualizacao.urlDaRelease("10.20.30"));
    }

    @Test
    public void qualquerOutroValorAbreSomenteLatest() {
        String[] invalidos = {
            null,
            "",
            "javascript:alert(1)",
            "http://github.com/CuryyOliveira/CrTech/releases",
            "https://outro-site.com",
            "https://github.com/outro/repo/releases/tag/android-v2.0.3",
            "2.0",
            "v2.0.3",
            "2.0.3.apk",
            "2.0.3/../../x",
            "02.0.3",
            "2.0.3\n",
            "intent://x#Intent;end",
            "file:///sdcard/a.apk",
        };
        for (String v : invalidos) {
            assertEquals(String.valueOf(v), OFICIAL + "/latest", Atualizacao.urlDaRelease(v));
        }
    }

    @Test
    public void urlSempreHttpsGithubOficial() {
        for (String v : new String[] { "2.0.3", "x", null }) {
            assertTrue(Atualizacao.urlDaRelease(v).startsWith(OFICIAL + "/"));
        }
    }

    @Test
    public void scriptExpoeVersaoSomenteNumerica() {
        String s = Atualizacao.scriptVersao("2.0.3", 15);
        assertTrue(s.contains("versionName:'2.0.3'"));
        assertTrue(s.contains("versionCode:15"));
        String injetado = Atualizacao.scriptVersao("2.0.3'});alert(1);//", 15);
        assertTrue(injetado.contains("versionName:''"));
        assertFalse(injetado.contains("alert"));
    }
}
