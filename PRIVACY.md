# Política de Privacidade — Dark Wick

_Última atualização: 30 de outubro de 2026_

A Dark Wick é uma extensão de navegador que aplica um modo escuro às páginas que você visita. Ela foi feita para funcionar inteiramente no seu dispositivo.

## Dados que coletamos

**Nenhum.** A Dark Wick não coleta, não transmite, não vende e não compartilha nenhum dado pessoal ou de navegação com o desenvolvedor nem com terceiros. A extensão não faz requisições de rede, não usa análises (analytics), não usa cookies de rastreamento e não exibe anúncios.

## Dados guardados no seu navegador

Para funcionar, a extensão guarda localmente, usando o armazenamento do próprio navegador (`chrome.storage`):

- **Suas preferências:** se a extensão está ligada e os valores de brilho, contraste, calor e tons de cinza.
- **Preferências por site:** o endereço (domínio) dos sites que você configurou de forma diferente do padrão — por exemplo, um site marcado como "Nunca" — e os ajustes próprios desse site.
- **Cache de sites escuros:** o domínio dos sites que a extensão detectou como já tendo tema escuro, para não escurecê-los de novo e evitar um "flash" claro ao abrir a página.

As preferências usam `chrome.storage.sync`. Se a sincronização do navegador estiver ativada, o próprio navegador (Chrome ou Brave) as sincroniza entre os seus dispositivos pela sua conta, conforme a política de privacidade do navegador. O desenvolvedor da Dark Wick não tem acesso a esses dados. O cache de sites escuros fica só neste dispositivo (`chrome.storage.local`).

Você pode apagar todos esses dados a qualquer momento removendo a extensão do navegador.

## Acesso ao conteúdo das páginas

A extensão pede permissão para rodar em todos os sites porque o seu único propósito é escurecer qualquer página que você abrir. Nas páginas, ela apenas insere uma folha de estilo e lê a cor de fundo de alguns pontos da tela para saber se o site já é escuro. Ela não lê, guarda ou envia textos, formulários, senhas ou qualquer outro conteúdo das páginas.

## Alterações

Se esta política mudar, a versão atualizada será publicada neste mesmo endereço, com a data de atualização revisada.

## Contato

Dúvidas sobre esta política: abra uma _issue_ no repositório do projeto no GitHub.
