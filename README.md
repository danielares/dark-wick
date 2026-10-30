# Dark Wick

Modo escuro leve para qualquer site, no Chrome e no Brave.

## Instalar (modo desenvolvedor)

1. Abra `chrome://extensions` (ou `brave://extensions`).
2. Ative **Modo do desenvolvedor**, no canto superior direito.
3. Clique em **Carregar sem compactação** e escolha esta pasta.
4. Fixe o ícone da chama na barra de ferramentas.

Atalho: **Alt+Shift+D** liga/desliga o site atual (pode ser alterado em `chrome://extensions/shortcuts`).

## Por que é leve

O modo dinâmico do Dark Reader lê todas as folhas de estilo da página, reescreve cada cor e observa o DOM inteiro para repetir isso a cada mudança. Em sites grandes e SPAs, isso consome muita CPU e memória.

O Dark Wick faz o contrário:

| | Dark Reader (dinâmico) | Dark Wick |
|---|---|---|
| Como escurece | Reescreve o CSS do site | Um único `filter` no `<html>`, executado pela GPU |
| Leitura de CSS | Todas as folhas, inclusive cross-origin via fetch | Nenhuma |
| Observação do DOM | Árvore inteira, contínua | Só os filhos diretos do `<html>` (para religar o `<style>` se um framework removê-lo) |
| Sites desligados | O script ainda roda | Nenhum código injetado (registro dinâmico com `excludeMatches`) |

- **Mídia preservada:** imagens, vídeos, `<picture>`, embeds de vídeo e fundos inline recebem o filtro inverso para manter as cores reais.
- **Sites já escuros:** no modo **Auto**, a página é amostrada em 6 pontos (no DOMContentLoaded, no load, 2 s depois e em navegações de SPA). Se ela já for escura, o filtro sai. O resultado fica em cache por site, para evitar o flash claro na próxima visita.
- **Top layer:** modais (`dialog`) e popovers recebem o mesmo filtro; elementos em tela cheia (vídeos) ficam com as cores originais.

## Limitações conhecidas (inerentes ao filtro)

- Cores muito saturadas em imagens perdem um pouco de saturação: o `hue-rotate` corta valores fora da gama de cores. Fotos comuns quase não mudam.
- Imagens de fundo definidas em CSS (não inline) e `<canvas>` são invertidas junto com a página. Para canvas, isso costuma ser bom (gráficos, Google Docs, mapas), mas é ruim em jogos.
- Logos PNG pretos com fundo transparente continuam pretos.

Se um site ficar ruim, use **Nunca** para ele, ou ajuste brilho/contraste com **Só neste site**.

## Estrutura

```
manifest.json
icons/              ícones (SVG fonte + PNGs; "off" = estado desligado)
src/background.js   registro dinâmico do content script, ícone por aba, atalho
src/content.js      filtro + detecção de site escuro (roda em document_start)
src/shared.js       defaults e helpers de storage (background + popup)
src/popup/          interface
```

Configurações ficam em `chrome.storage.sync` (`global` e `site:<host>`), e o cache de sites escuros em `chrome.storage.local`.
