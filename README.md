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
| Varredura do DOM | Árvore inteira, reescrevendo estilos | Só procura fotos em `background-image`, fundos de cor da marca e Shadow DOM, em tempo ocioso (`requestIdleCallback`), nos elementos novos e só com o filtro ativo |
| Sites desligados | O script ainda roda | Nenhum código injetado (registro dinâmico com `excludeMatches`) |

- **Mídia preservada:** imagens, vídeos, `<picture>`, embeds de vídeo, iframes de anúncio, fotos de fundo (inline ou do CSS, inclusive em `::before`/`::after`, se forem grandes) e imagens dentro de Shadow DOM aberto recebem o filtro inverso. Cards com texto sobre a foto são revertidos inteiros, ficando como no original.
- **Identidade visual:** a varredura marca fundos de cor viva (cabeçalhos e botões da marca) ou já escuros e os mantém com as cores originais, junto com o logo e o texto dentro deles. Assim, o cabeçalho vermelho do g1 continua vermelho, com o logo branco. Imagens pequenas (até 32 px) e SVGs são tratados como ícones e escurecem com o texto.
- **Fidelidade de cor:** o filtro corta valores fora de [0,1] entre etapas, o que desbotava cores vivas. A página recebe `saturate(1.6)` e as mídias dessaturam antes de reverter, ficando dentro da faixa. As mídias também desfazem o contraste reduzido, que é pensado para o texto. Em tons de pele, o erro em relação ao original caiu de ~7 para ~2 (de 255).
- **Sites já escuros:** no modo **Auto**, a página é amostrada em 6 pontos (no DOMContentLoaded, no load, 2 s depois e em navegações de SPA). Se ela já for escura, o filtro sai. O resultado fica em cache por site, para evitar o flash claro na próxima visita.
- **Top layer:** modais (`dialog`) e popovers recebem o mesmo filtro; elementos em tela cheia (vídeos) ficam com as cores originais.

## Limitações conhecidas (inerentes ao filtro)

- Cores extremamente vivas (amarelo ou vermelho puros) ainda saem um pouco alteradas (por exemplo, um vermelho de marca fica um pouco mais escuro). Fotos comuns ficam praticamente iguais.
- Textos coloridos (como manchetes vermelhas) viram um tom mais claro da mesma cor, de propósito, para ficarem legíveis no fundo escuro.
- Ícones pequenos e texturas de fundo invertem junto com a página (de propósito). Elementos de fundo que só ganham a foto depois, por troca de classe, podem escapar da varredura.
- `<canvas>` e Shadow DOM fechado são invertidos junto com a página. Para canvas, isso costuma ser bom (gráficos, Google Docs, mapas), mas é ruim em jogos.
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
tools/package.py    gera dist/dark-wick-<versão>.zip para a Chrome Web Store
store/              textos da loja (LISTING.md), imagens (assets/) e as cenas que as geram (src/, build.py)
PRIVACY.md          política de privacidade
```

## Publicar na Chrome Web Store

```
python tools/package.py   # zip com só os arquivos da extensão, conferindo o manifest
python store/build.py     # regenera as imagens da loja (precisa de Pillow e Chrome/Brave)
```

O passo a passo, com o texto de cada campo do painel, está em [store/LISTING.md](store/LISTING.md).

Configurações ficam em `chrome.storage.sync` (`global` e `site:<host>`), e o cache de sites escuros em `chrome.storage.local`.
