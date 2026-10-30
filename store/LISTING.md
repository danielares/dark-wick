# Envio para a Chrome Web Store — o que colar em cada campo

Painel: https://chrome.google.com/webstore/devconsole

## 0. Antes de enviar

```
python tools/package.py      # gera dist/dark-wick-<versão>.zip
python store/build.py        # (opcional) regenera as imagens em store/assets/
```

Teste o `.zip` antes: descompacte numa pasta e carregue em `brave://extensions` → "Carregar sem compactação".
A cada nova versão, aumente `version` no `manifest.json`.

---

## 1. Pacote

**Novo item** → envie `dist/dark-wick-1.0.0.zip`.

## 2. Listagem na loja (Store listing)

**Idioma:** Português (Brasil)

**Nome** (vem do manifest): Dark Wick

**Resumo** (vem do manifest, máx. 132 caracteres):
> Modo escuro leve para qualquer site — um único filtro na GPU, sem reescrever o CSS da página.

**Descrição:**

```
Dark Wick deixa qualquer site com visual escuro sem deixar o navegador pesado.

COMO FUNCIONA
Em vez de ler e reescrever as folhas de estilo de cada página, a Dark Wick aplica um único filtro de cor à página, processado pela placa de vídeo. Por isso ela não fica analisando o site nem refazendo trabalho a cada mudança na página — mesmo em sites grandes e aplicativos web.

RECURSOS
• Escurece qualquer site com um clique.
• Fotos e vídeos não ficam invertidos.
• Modo Auto: detecta quando o site já tem tema escuro e não mexe nele.
• Três modos por site: Auto, Sempre ou Nunca.
• Ajuste de brilho, contraste, calor (tom amarelado) e tons de cinza — para todos os sites ou só para o site atual, com prévia ao vivo.
• Atalho de teclado: Alt+Shift+D liga e desliga o site atual.
• Nos sites marcados como "Nunca", nenhum código da extensão é carregado.

PRIVACIDADE
A Dark Wick não coleta nem envia nenhum dado. Ela não faz requisições de rede, não usa analytics e não exibe anúncios. Suas preferências ficam guardadas no próprio navegador.

LIMITAÇÕES
Como a extensão usa um filtro de cor, cores extremamente vivas em imagens (como amarelo ou vermelho puros) podem ficar levemente alteradas. Ícones pequenos e texturas de fundo são escurecidos junto com a página. Se algum site não ficar bom, marque "Nunca" para ele.
```

**Categoria:** Acessibilidade

**Imagens** (pasta `store/assets/`):

| Campo | Arquivo |
|---|---|
| Ícone da loja (128×128) | `store-icon-128.png` |
| Capturas de tela (1280×800) | `screenshot-1.png`, `screenshot-2.png`, `screenshot-3.png` |
| Bloco promocional pequeno (440×280) | `promo-small-440x280.png` |
| Bloco promocional de destaque (1400×560) | `promo-marquee-1400x560.png` |

**Site oficial / Suporte:** URL do repositório no GitHub (opcional).

## 3. Privacidade (Privacy practices)

**Finalidade única (Single purpose):**

```
Aplicar um modo escuro às páginas da web que o usuário visita, com controles para ligar/desligar por site e ajustar brilho, contraste, calor e tons de cinza.
```

**Justificativa das permissões:**

| Permissão | Justificativa (colar) |
|---|---|
| `storage` | Guardar as preferências do usuário (ligado/desligado, modo por site, brilho, contraste, calor e tons de cinza) e um cache local dos sites que já têm tema escuro. |
| `scripting` | Registrar o script que aplica o modo escuro ao carregar as páginas, excluindo os sites que o usuário desativou, e aplicá-lo nas abas já abertas quando o usuário liga a extensão ou um site. |
| `favicon` | Mostrar o ícone do site atual no popup da extensão, para o usuário identificar a qual site as configurações se aplicam. |
| Permissão de host (`http://*/*`, `https://*/*`) | A única função da extensão é escurecer qualquer site que o usuário abrir, por isso ela precisa inserir sua folha de estilo em todas as páginas http/https. A extensão não lê nem transmite o conteúdo das páginas; ela apenas insere CSS e lê a cor de fundo de alguns pontos da tela para detectar se o site já é escuro. |

**Código remoto (Remote code):** Não, não estou usando código remoto.

**Uso de dados (Data usage):** não marque nenhuma categoria de dados.
Marque as três declarações:
- Não vendo nem transfiro dados de usuários a terceiros, fora dos casos de uso aprovados.
- Não uso nem transfiro dados de usuários para fins não relacionados à finalidade única do item.
- Não uso nem transfiro dados de usuários para determinar capacidade de crédito ou para fins de empréstimo.

**URL da política de privacidade:**

```
https://github.com/danielares/dark-wick/blob/master/PRIVACY.md
```

(o repositório precisa ser **público** para o link abrir sem login)

## 4. Distribuição

- **Visibilidade:** *Não listado* (só quem tem o link encontra) ou *Público*.
- **Regiões:** Todas.

## 5. Instruções de teste (Test instructions) — opcional, ajuda o revisor

```
Nenhum login é necessário.
1. Abra um site claro (ex.: https://pt.wikipedia.org) — ele fica escuro automaticamente.
2. Clique no ícone da chama: o popup mostra o site atual e o status "Escuro ativo".
3. Selecione "Nunca" para restaurar as cores originais do site; "Auto" para escurecer de novo.
4. Mova os controles de brilho/contraste para ver a prévia ao vivo.
5. Abra um site que já é escuro (ex.: https://github.com com tema escuro) — no modo Auto ele é mantido e o popup mostra "Site já é escuro — mantido".
6. Atalho: Alt+Shift+D liga/desliga o site atual.
```
