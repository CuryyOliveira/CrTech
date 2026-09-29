/**
 * Aviso para navegador/WebView desatualizado. O visual do sistema (Tailwind v4: `@layer`, cores
 * `oklch`) exige Chrome/Android System WebView 111 ou mais novo; num WebView de fábrica sem
 * atualização a página abriria quebrada. Este script é ES5 puro (roda em qualquer WebView),
 * não faz nada em navegadores atuais e, nos antigos, mostra como atualizar.
 */
export const SCRIPT_NAVEGADOR_ANTIGO = `(function(){try{
var ok=window.CSS&&CSS.supports&&CSS.supports("color","oklch(0.5 0.1 45)");
if(ok)return;
var mostrar=function(){if(document.getElementById("cr-navegador-antigo"))return;
var d=document.createElement("div");d.id="cr-navegador-antigo";d.setAttribute("role","alert");
d.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483647;background:#fff;color:#1c1917;font:16px/1.5 sans-serif;padding:24px;overflow:auto";
d.innerHTML='<h1 style="font-size:22px;margin:0 0 12px">Atualize o navegador do aparelho</h1>'
+'<p style="margin:0 0 12px">Este aparelho está com uma versão antiga do <b>Android System WebView</b> (ou do Google Chrome), que não consegue abrir o Conferência Rápida corretamente.</p>'
+'<p style="margin:0 0 20px">Abra a Play Store, procure por <b>Android System WebView</b> e toque em <b>Atualizar</b>. Depois, abra o aplicativo de novo.</p>'
+'<a href="market://details?id=com.google.android.webview" style="display:inline-block;background:#9a3412;color:#fff;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Atualizar pela Play Store</a>';
(document.body||document.documentElement).appendChild(d);};
if(document.body)mostrar();else document.addEventListener("DOMContentLoaded",mostrar);
}catch(e){}})();`;
