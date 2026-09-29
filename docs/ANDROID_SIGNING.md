# Assinatura do aplicativo Android

> Nenhuma chave privada, senha ou APK foi publicado ou adicionado ao Git nesta fase.
> A chave de produção **ainda não foi criada**: ela deve ser gerada pelo proprietário (§4).

## 1. Situação atual verificada (APK distribuído hoje)

Verificação feita em 29/09/2026 no arquivo publicado na Release `android-claude-app-to-android-apk-irx1ru`, repetida automaticamente pelo job "APK distribuído hoje" do workflow `android-v2-assinatura.yml`.

| Item | Valor |
|---|---|
| Arquivo | `conferencia-rapida-1.0.3-release.apk` (SHA-256 do arquivo `a041a96d…6ec2f`, igual ao publicado) |
| Package name / applicationId | `br.com.conferenciarapida.app` |
| versionName / versionCode | `1.0.3` / `6` (build 6 do GitHub Actions, commit `9ab60e9`) |
| minSdk / targetSdk | 24 (Android 7.0) / 36 |
| Esquemas de assinatura | v2 apenas (sem v1 e sem v3) |
| Certificado | `CN=Android Debug, O=Android, C=US`, RSA 2048, válido até 2054 |
| **SHA-256 do certificado** | `2A:C3:D1:95:B7:38:4F:4A:C4:B9:E0:15:11:34:88:B2:20:D8:97:9A:B4:F9:AC:FD:A6:14:73:8C:99:02:68:B7` |
| SHA-1 do certificado | `39:4C:98:5F:0F:78:5E:ED:B7:85:26:06:35:0B:AA:4A:9F:CF:93:73` |
| Origem da chave | `mobile/android/app/debug.keystore`, **versionada no repositório público**, com senha padrão `android` |
| Mecanismo de atualização | Manual: o usuário baixa o APK da Release e instala por cima. O conteúdo web atualiza sozinho, porque o app carrega o site; só mudanças nativas exigem APK novo |
| Downloads do APK release | 1 (em 29/09/2026) |

**Risco (crítico):** qualquer pessoa pode assinar um APK com essa chave, e o Android o aceita como atualização legítima do app instalado, com acesso aos dados locais.

## 2. Regra de ouro: não perder a atualização dos aparelhos atuais

O Android só instala uma atualização se ela for assinada pela **mesma chave** do app instalado, ou por uma chave nova com **prova de rotação** a partir dela (APK Signature Scheme v3, Android 9+).
- Trocar a chave sem rotação obriga cada usuário a **desinstalar** o app, perdendo os dados locais: cofre offline, pendências não sincronizadas e cache.
- Por isso a V2 **nunca** usa a chave nova sozinha.

## 3. Estratégia escolhida: rotação de chave (sem desinstalar)

O release é gerado sem assinatura e assinado pelo `apksigner` com as duas chaves (`scripts/android/assinar-com-rotacao.sh`):
- **Android 9 ou superior:** esquema v3 com a prova de rotação `debug → produção`, e `rollback` desativado. Depois de atualizar uma vez, o aparelho **só aceita a chave de produção**; um APK assinado apenas com a chave antiga (pública) é recusado.
- **Android 7 e 8** (API 24–27, que não suportam rotação): esquema v2 com a **chave antiga**. A atualização funciona, mas nesses aparelhos a chave antiga continua valendo (**risco residual**, ver §7).

### Resultados dos testes em emulador

Workflow `android-v2-assinatura.yml`, job "Rotação de chave e atualização em emulador". Os APKs de teste usam chaves **temporárias** geradas na hora e descartadas.

| Cenário | Android 8 (API 26) | Android 11 (API 30) |
|---|---|---|
| Instalar versão atual (chave antiga) | ver CI | ver CI |
| **Atualizar** para versão com rotação (sem desinstalar, dados preservados) | ver CI | ver CI |
| Atualizar sobre versão assinada com a mesma chave nova | ver CI | ver CI |
| APK com outra chave qualquer é recusado | ver CI | ver CI |
| APK só com a chave antiga (pública) após a rotação | aceito (risco residual) | **recusado** |
| App abre após as atualizações | ver CI | ver CI |
| Instalação limpa da versão nova | ver CI | ver CI |

A verificação (`scripts/android/verificar-apk.sh`) confere package name, versionCode, validade da assinatura, a presença da chave atual e, quando informada, da chave de produção e da cadeia de rotação. Ela **bloqueia** APK que não instalaria por cima do app atual, e o teste do CI comprova esse bloqueio.

## 4. Criar a chave de produção (feito por você, fora do Git)

Em um computador com Java instalado (Android Studio já traz o `keytool`), fora da pasta do projeto:

```bash
keytool -genkeypair -v -keystore conferencia-rapida-producao.jks -storetype PKCS12 \
  -alias conferencia-rapida -keyalg RSA -keysize 4096 -validity 36500 \
  -dname "CN=Conferência Rápida, O=<sua empresa>, C=BR"
```
- Use uma senha forte. No formato PKCS12, a senha da chave é a mesma do keystore.
- **Faça 2 cópias de segurança** do arquivo `.jks` e da senha, por exemplo num gerenciador de senhas e num pendrive guardado. **Perder esta chave = nunca mais conseguir atualizar o app.**
- Anote o fingerprint (é público, pode ser compartilhado):
  `keytool -list -v -keystore conferencia-rapida-producao.jks -alias conferencia-rapida | grep SHA256`
- Gere o conteúdo do secret em base64, numa linha só:
  - Linux: `base64 -w0 conferencia-rapida-producao.jks`
  - macOS: `base64 -i conferencia-rapida-producao.jks`
  - Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("conferencia-rapida-producao.jks"))`

**Secrets do GitHub** (Settings → Secrets and variables → Actions → New repository secret):

| Secret | Valor |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | conteúdo base64 do `.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | senha do keystore |
| `ANDROID_KEY_ALIAS` | `conferencia-rapida` |
| `ANDROID_KEY_PASSWORD` | senha da chave (igual à do keystore no PKCS12) |

> ### ⚠️ ATENÇÃO — ordem obrigatória
> O workflow de **produção atual** (`android-apk.yml` na branch `claude/app-to-android-apk-irx1ru`) já lê `ANDROID_KEYSTORE_BASE64`. **Se esse secret existir**, o próximo APK publicado por aquela branch será assinado **só com a chave nova, sem rotação**, e **não instalará por cima** do app atual.
>
> Enquanto a V2 não estiver integrada à produção, há duas opções seguras:
> 1. **Recomendado:** só cadastrar os secrets **junto** com a integração do novo `android-apk.yml` (versão da `v2-development`, que usa rotação e exige aprovação explícita); ou
> 2. cadastrar agora e **não fazer nenhum push em `mobile/**`** na branch de produção até a integração.

Com os secrets cadastrados, o job "Chave de produção" do workflow da V2:
- valida alias e senha, e mostra o fingerprint;
- recusa a `debug.keystore` como chave de produção;
- assina um APK de teste com rotação e o verifica.

Ele **não publica nada**.

## 5. Transição segura (quando a Fase 0 for aprovada)

1. Chave criada e com backup (§4). Fingerprint anotado neste documento.
2. Integrar a `v2-development` à produção; o novo `android-apk.yml` é seguro por padrão.
3. Cadastrar os 4 secrets.
4. Criar a **variável** do repositório `ANDROID_ROTACAO_APROVADA=true` (Settings → Variables).
   - Sem ela, o workflow continua assinando com a chave atual, exatamente como hoje.
   - Com ela, assina com rotação e verifica a compatibilidade **antes** de publicar.
5. Publicar o APK de transição (versionCode maior). Instalar por cima em um aparelho de teste e confirmar que os dados continuam.
6. Avisar os usuários para atualizar pelo link da Release.
7. **Após a transição:**
   - a `debug.keystore` continua no repositório, porque é necessária para assinar a rotação e o esquema v2 dos aparelhos com Android 7/8;
   - para esses aparelhos, a proteção só vem com a troca completa de chave (§7).

## 6. O que NÃO foi feito (de propósito)

- Nenhuma chave de produção foi criada neste ambiente (a chave privada não deve passar por ele).
- Nenhum secret foi cadastrado (sem acesso, e pela ordem obrigatória acima).
- Nenhum APK foi publicado nem enviado como artefato. Os APKs de teste existem só durante o job do CI.
- A assinatura do app distribuído **não foi alterada**.

## 7. Riscos restantes

| Risco | Situação | Tratamento |
|---|---|---|
| Chave antiga pública | Continua válida até a transição (§5) | Rotação na V2 |
| Aparelhos Android 7/8 | Não suportam rotação: a chave antiga continua aceita neles | Após a transição, avaliar exigir Android 9+ (`minSdk 28`) em uma versão futura, ou trocar de chave com reinstalação só nesses aparelhos |
| Perda da chave de produção | Impede atualizações futuras | Duas cópias de segurança (§4) |
| Instalação fora de loja | O usuário precisa permitir "fontes desconhecidas" | Avaliar Google Play (Play App Signing) na V2.5 |
