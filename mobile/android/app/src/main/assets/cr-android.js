/*
 * Adaptações do Conferência Rápida para o WebView do Android.
 *
 * O WebView não baixa arquivos gerados no navegador (blob:/data:), não tem
 * window.print() e não abre janelas novas. Este script, injetado pelo app
 * nativo apenas nas origens do sistema, encaminha essas ações para o Android
 * através do canal "CRNativo":
 *   - exportações (PDF, Excel, CSV, backup JSON) são salvas em Downloads;
 *   - impressões (window.print e relatórios em nova janela) usam o serviço de
 *     impressão do Android (imprimir ou salvar como PDF);
 *   - links externos com target=_blank abrem no navegador do celular.
 */
(function () {
  "use strict";
  if (window.__crAndroid) return;
  var canal = window.CRNativo;
  if (!canal || typeof canal.postMessage !== "function") return;
  window.__crAndroid = true;

  function enviar(msg) {
    try {
      canal.postMessage(JSON.stringify(msg));
    } catch (e) {
      console.error("[CRNativo]", e);
    }
  }

  // Guarda os Blobs criados, pois as bibliotecas revogam a URL logo após o clique.
  var blobs = new Map();
  var criarURL = URL.createObjectURL.bind(URL);
  var revogarURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    var url = criarURL(obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    setTimeout(function () {
      blobs.delete(url);
      revogarURL(url);
    }, 60000);
  };

  function nomeDoArquivo(a, mime) {
    var nome = (a.getAttribute("download") || "").trim();
    if (!nome) {
      var ext = {
        "application/pdf": ".pdf",
        "text/csv": ".csv",
        "application/json": ".json",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
      }[String(mime || "").split(";")[0]];
      nome = "arquivo-" + Date.now() + (ext || "");
    }
    return nome.replace(/[\\/:*?"<>|]+/g, "-");
  }

  function lerBlob(href) {
    var guardado = blobs.get(href);
    if (guardado) return Promise.resolve(guardado);
    return fetch(href).then(function (r) {
      return r.blob();
    });
  }

  function salvar(a) {
    var href = a.href;
    lerBlob(href)
      .then(function (blob) {
        return new Promise(function (ok, erro) {
          var leitor = new FileReader();
          leitor.onload = function () {
            ok({ blob: blob, dataUrl: String(leitor.result) });
          };
          leitor.onerror = function () {
            erro(leitor.error);
          };
          leitor.readAsDataURL(blob);
        });
      })
      .then(function (r) {
        var virgula = r.dataUrl.indexOf(",");
        var mime = r.blob.type || r.dataUrl.slice(5, r.dataUrl.indexOf(";")) || "application/octet-stream";
        enviar({
          tipo: "arquivo",
          nome: nomeDoArquivo(a, mime),
          mime: mime,
          dados: r.dataUrl.slice(virgula + 1),
        });
      })
      .catch(function (e) {
        console.error("[CRNativo] Falha ao gerar o arquivo", e);
        enviar({ tipo: "erro", mensagem: "Não foi possível salvar o arquivo." });
      });
  }

  function ehDownload(a) {
    if (!a || !a.href) return false;
    var p = a.protocol;
    return p === "blob:" || p === "data:" || (a.hasAttribute("download") && a.origin === location.origin);
  }

  function ehExterno(a) {
    if (!a || !a.href) return false;
    var p = a.protocol;
    return (p === "http:" || p === "https:") && a.origin !== location.origin;
  }

  // Cliques programáticos (XLSX.writeFile, jsPDF.save, relatórios CSV).
  var clicar = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (ehDownload(this)) return salvar(this);
    if (this.target === "_blank" && ehExterno(this)) return enviar({ tipo: "externo", url: this.href });
    return clicar.apply(this, arguments);
  };
  var despachar = HTMLAnchorElement.prototype.dispatchEvent;
  HTMLAnchorElement.prototype.dispatchEvent = function (ev) {
    if (ev && ev.type === "click" && !this.isConnected && ehDownload(this)) {
      salvar(this);
      return false;
    }
    return despachar.apply(this, arguments);
  };

  // Cliques do usuário em links de download ou externos (_blank).
  document.addEventListener(
    "click",
    function (ev) {
      if (ev.defaultPrevented) return;
      var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
      if (!a) return;
      if (ehDownload(a)) {
        ev.preventDefault();
        salvar(a);
      } else if (a.target === "_blank" && ehExterno(a)) {
        ev.preventDefault();
        enviar({ tipo: "externo", url: a.href });
      }
    },
    true,
  );

  // Impressão da página atual.
  window.print = function () {
    enviar({ tipo: "imprimirPagina", titulo: document.title || "" });
  };

  // window.open: janelas em branco (relatórios para imprimir) viram impressão
  // nativa; URLs externas abrem no navegador do celular.
  var abrir = window.open;
  window.open = function (url, alvo, recursos) {
    var destino = url == null ? "" : String(url);
    if (destino === "" || destino === "about:blank") {
      var partes = [];
      var falsa = {
        closed: false,
        opener: window,
        focus: function () {},
        blur: function () {},
        print: function () {},
        close: function () {
          falsa.closed = true;
        },
        location: { href: "about:blank" },
        document: {
          open: function () {
            partes = [];
          },
          write: function () {
            partes.push(Array.prototype.join.call(arguments, ""));
          },
          writeln: function () {
            partes.push(Array.prototype.join.call(arguments, "") + "\n");
          },
          close: function () {
            var html = partes.join("");
            var titulo = (/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || document.title || "";
            enviar({ tipo: "imprimirHtml", html: html, titulo: titulo });
          },
        },
      };
      return falsa;
    }
    try {
      var alvoUrl = new URL(destino, location.href);
      if ((alvoUrl.protocol === "http:" || alvoUrl.protocol === "https:") && alvoUrl.origin !== location.origin) {
        enviar({ tipo: "externo", url: alvoUrl.href });
        return null;
      }
    } catch (e) {
      /* URL inválida: segue o comportamento padrão */
    }
    return abrir.apply(window, arguments);
  };
})();
