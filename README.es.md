[English](README.md) | [Español](README.es.md) | [简体中文](README.zh-CN.md)

> **Comportamiento 0.7.5:** el árbol **Review Changes** ahora muestra `✓ Aceptar todos los cambios del archivo` y `↶ Rechazar todos los cambios del archivo` como atajos opcionales a nivel de archivo. La revisión inline sigue siendo estrictamente por bloque.

> **Comportamiento 0.7.4:** conserva la compuerta de 0.7.3 que muestra acciones solo para cambios nuevos y corrige **Pedir corrección** para que el feedback del bloque seleccionado llegue al agente como un único mensaje.


> **Corrección 0.7.2:** abrir un archivo no crea cambios fantasma de archivo completo cuando Git y el working tree usan terminadores de línea distintos. Las decisiones siguen siendo por bloque.

# CodeBender

**Revisión de código human-in-the-loop para agentes de programación con IA — directamente dentro de VS Code.**

CodeBender convierte las ediciones realizadas por agentes de programación con IA en bloques de cambio revisables dentro del archivo fuente original. Puedes aceptar o rechazar cada bloque de forma independiente, preparar en Git el código aceptado, devolver un bloque al agente con comentarios, navegar entre cambios pendientes y conservar un historial ligero de revisión respaldado por Git.

> CodeBender es neutral respecto del proveedor. Puede trabajar con Claude Code, Codex, Kimi Code, Gemini CLI, OpenCode, la terminal activa de VS Code o un adaptador CLI personalizado.

## Para qué sirve CodeBender

Los agentes de programación con IA pueden modificar muchos archivos en segundos. CodeBender agrega una capa de aprobación humana entre esas ediciones y el estado final del código.

```text
Agente de programación con IA
      ↓
modifica archivos del workspace
      ↓
CodeBender detecta bloques cambiados
      ↓
┌────────────────────────────────────────────┐
│  IA: Claude Code · bloque 2/5             │
│                                            │
│  ✓ Aceptar    ⎇ Aceptar + Stage          │
│  ↶ Rechazar   💬 Solicitar corrección     │
│                                            │
│  código modificado                         │
└────────────────────────────────────────────┘
      ↓
decisión humana
      ↓
Git / ciclo de retroalimentación con el agente
```

El objetivo es ofrecer una experiencia de revisión por bloques similar a la de los asistentes de programación modernos, sin quedar atado a un proveedor y utilizando APIs públicas de extensiones de VS Code.

---

## Novedades de CodeBender 0.7.2

La versión 0.7.2 conserva el arranque rápido Git-first de 0.7.0 y devuelve el modelo de revisión a **decisiones estrictamente por bloque**.

### Revisión por bloque con atajos opcionales por archivo

La revisión inline sigue siendo estrictamente por bloque. Abre el archivo y decide directamente sobre cada hunk:

- **Aceptar** — acepta únicamente el bloque seleccionado.
- **Aceptar + Stage** — acepta y lleva al staging únicamente el bloque seleccionado.
- **Rechazar** — restaura únicamente el bloque seleccionado.
- **Pedir corrección** — envía únicamente ese bloque al agente configurado.

Desde el árbol **Review Changes**, CodeBender también ofrece dos atajos explícitos para archivos normales: **Aceptar todos los cambios del archivo** y **Rechazar todos los cambios del archivo**. Estos botones deciden todos los bloques pendientes de ese archivo sin abrirlo; no cambian el comportamiento por bloque de los controles inline.

Un archivo eliminado por completo se considera un único bloque de eliminación, porque ya no existe un documento fuente donde mostrar CodeLens; para ese caso especial el árbol expone acciones por bloque.

### Corrección de Aceptar + Stage

El baseline rápido de 0.7.0 podía ser distinto del índice Git real cuando ya existía trabajo antes de iniciar la sesión. La validación anterior rechazaba esos casos de forma demasiado estricta.

0.7.2 aplica ahora el hunk seleccionado sobre el **contenido actual del índice Git**, en lugar de reemplazar el archivo staged con todo el baseline de revisión. Así conserva cambios staged no relacionados y evita stagear trabajo unstaged que ya existía antes de la sesión. Si el bloque se solapa con un cambio incompatible, CodeBender aborta antes de escribir el índice.

### Pruebas automatizadas de regresión

El ZIP fuente incluye ahora pruebas Node para bloques independientes, Aceptar + Stage, cambios staged y unstaged previos, inserciones, eliminaciones y manejo seguro de conflictos.

---

## Novedades de CodeBender 0.7.0

La versión 0.7.0 se centra en **rendimiento al iniciar, versionamiento Git-first y mayor confiabilidad de snapshots**.

### Baseline Git-first y carga perezosa

En un workspace Git, CodeBender ya no necesita copiar todo el proyecto al almacenamiento global de VS Code al iniciar una sesión de revisión.

#### Repositorio limpio

CodeBender puede reutilizar el `HEAD` actual como baseline de revisión.

```text
Iniciar sesión de revisión
        ↓
Git detectado
        ↓
working tree limpio
        ↓
HEAD se convierte en baseline
        ↓
listo
```

No se requiere una copia completa del proyecto.

#### Repositorio con cambios locales previos

Si ya tienes trabajo sin commit, CodeBender conserva exactamente el estado inicial mediante un **índice Git temporal aislado** y un checkpoint interno.

```text
HEAD
 +
cambios locales existentes
        ↓
índice Git temporal
        ↓
checkpoint baseline de CodeBender
```

El área de staging real de Git no se utiliza para crear ese checkpoint.

#### Carga perezosa del contenido

El contenido original de un archivo se carga únicamente cuando ese archivo es relevante para una decisión de revisión.

Por ejemplo, si un repositorio contiene 10.000 archivos y el agente modifica 4, CodeBender no necesita leer y copiar primero los otros 9.996.

```text
Repositorio Git con 10.000 archivos
        ↓
baseline Git
        ↓
el agente modifica auth.ts
        ↓
cargar solo el baseline de auth.ts
        ↓
calcular bloques de revisión
```

### Actualización más rápida

En raíces respaldadas por Git, CodeBender consulta a Git las rutas cambiadas siempre que es posible, en lugar de volver a escanear y hashear todo el workspace.

### Fallback de snapshots más confiable

Las carpetas no cubiertas por Git siguen usando el motor de snapshots. En 0.7.0:

- los directorios de almacenamiento se crean antes de iniciar workers concurrentes;
- `snapshots` y `undo` se inicializan una sola vez;
- las carpetas comunes de dependencias y compilación continúan excluidas por defecto;
- se evita la condición de carrera que podía producir `ENOENT ... globalStorage/.../snapshots/...`.

### Menos trabajo Git automático

`codeBender.git.checkpointOnDecision` ahora tiene valor predeterminado `false`.

Aceptar o rechazar cada bloque ya no crea automáticamente otro checkpoint Git, salvo que lo habilites expresamente.

---

## Funciones principales

### Revisión inline por bloques

Los cambios independientes dentro de un mismo archivo permanecen como decisiones independientes.

Cada hunk pendiente puede mostrar acciones CodeLens directamente sobre el código modificado y un indicador en el gutter del editor.

- **Aceptar** — conserva únicamente ese bloque como parte del nuevo baseline de revisión.
- **Aceptar + Stage** — acepta el bloque y prepara de forma segura el estado aceptado cuando las validaciones Git lo permiten.
- **Rechazar** — restaura únicamente ese bloque al estado baseline.
- **Solicitar corrección** — genera contexto del bloque y lo envía al agente seleccionado con tus comentarios.

Ejemplo:

```text
archivo: src/auth.ts

✓ Aceptar   ⎇ Aceptar + Stage   ↶ Rechazar   💬 Solicitar corrección
────────────────────────────────────────────────────────────────────
Bloque 1
lógica de autenticación modificada

...

✓ Aceptar   ⎇ Aceptar + Stage   ↶ Rechazar   💬 Solicitar corrección
────────────────────────────────────────────────────────────────────
Bloque 2
lógica de validación modificada
```

Aceptar o rechazar el Bloque 1 no decide automáticamente el Bloque 2.

### Indicadores en el gutter

Los cambios inline pendientes se marcan en el margen del editor para identificar rápidamente dónde quedan decisiones por revisar sin abrir una vista de diff tradicional de archivo completo.

### Badges en el Explorador

Los archivos con cambios pendientes pueden mostrar un badge en el Explorador de VS Code.

Para desactivarlos:

```json
{
  "codeBender.explorer.badges": false
}
```

### Navegación entre cambios

Atajos predeterminados:

| Acción | Windows / Linux | macOS |
|---|---|---|
| Siguiente cambio pendiente | `Alt+Shift+Down` | `Alt+Shift+Down` |
| Cambio pendiente anterior | `Alt+Shift+Up` | `Alt+Shift+Up` |
| Deshacer última decisión | `Ctrl+Alt+Z` | `Cmd+Alt+Z` |

### Deshacer decisiones de revisión

**CodeBender: Undo Last Decision** restaura el estado anterior de revisión.

Cuando la decisión fue `Aceptar + Stage`, CodeBender también conserva suficiente información del índice Git para intentar restaurar la entrada anterior del índice.

---

## Integración y versionamiento con Git

CodeBender usa Git con dos propósitos diferentes:

1. **Baseline / checkpoints de revisión** — versionamiento interno que no debe mover tu rama actual ni `HEAD`.
2. **Aceptar + Stage** — acción explícita que sí actualiza intencionalmente el índice Git real para el estado aceptado.

### Checkpoints internos

Los checkpoints pueden vivir bajo referencias internas como:

```text
refs/codebender/<session>/checkpoints/00001
```

Crear un checkpoint no requiere cambiar de rama.

### Índice Git temporal

La creación de checkpoints usa un `GIT_INDEX_FILE` temporal, de modo que el staging normal del usuario no se reemplaza solo para capturar un baseline.

```text
Tu índice normal
      │
      └── no se toca al crear checkpoints

CodeBender
      │
      └── índice temporal → tree → checkpoint interno
```

### Seguridad de Aceptar + Stage

`Aceptar + Stage` sí modifica intencionalmente el índice Git real para el estado seleccionado.

Antes de hacerlo, CodeBender comprueba que el estado existente del índice para ese archivo coincida con el baseline esperado. Si existe ambigüedad, la operación se rechaza en vez de sobrescribir silenciosamente trabajo staged que no pertenece a CodeBender.

### Git Timeline

La vista relacionada con Git puede mostrar:

- rama actual;
- cantidad de archivos staged, modificados y untracked;
- commits Git recientes;
- checkpoints internos de CodeBender.

### Flujo Git recomendado

```text
Iniciar sesión de revisión
        ↓
el agente modifica código
        ↓
revisar bloques inline
        ├── Aceptar
        ├── Aceptar + Stage
        ├── Rechazar
        └── Solicitar corrección
        ↓
resolver todos los bloques previstos
        ↓
ejecutar pruebas / build
        ↓
commit con tu flujo Git normal
        ↓
push solo cuando tú lo decidas
```

CodeBender no necesita hacer `push` automáticamente.

---

## Ciclo de retroalimentación con agentes

CodeBender puede devolver un bloque seleccionado al agente de programación con comentarios del revisor.

El contexto generado puede incluir:

- workspace y ruta del archivo;
- rango de líneas modificadas;
- bloque original;
- bloque actual;
- comentario del revisor;
- contexto cercano opcional o el archivo completo.

De forma predeterminada, CodeBender inserta el prompt generado en la terminal integrada seleccionada **sin presionar Enter automáticamente**.

Esto mantiene al usuario en control antes de que el agente reciba la instrucción.

### Adaptadores incluidos

- Claude Code
- Codex
- Kimi Code
- Gemini CLI
- OpenCode
- Terminal integrada activa

### Adaptador CLI personalizado

Puedes añadir agentes desde `settings.json`:

```json
{
  "codeBender.agent.adapters": [
    {
      "id": "my-agent",
      "label": "My Agent",
      "command": "my-agent-cli",
      "matchers": ["my agent", "my-agent"]
    }
  ]
}
```

CodeBender no requiere por sí mismo una API key de Anthropic, OpenAI, Moonshot, Google u otro proveedor de IA.

---

## Atribución de cambios

CodeBender soporta atribución best-effort para los bloques de revisión, por ejemplo:

- **Manual**
- un agente seleccionado
- **Mixed** cuando existen ediciones superpuestas asociadas a más de una fuente

Usa **CodeBender: Select Change Source** para indicar quién producirá las siguientes ediciones.

Enviar una corrección a un agente también puede convertir ese agente en la fuente activa.

> VS Code no expone una señal criptográficamente confiable que identifique exactamente qué proceso externo escribió cada carácter. La atribución es aproximada y no debe considerarse evidencia de autoría con nivel de auditoría.

---

## Pausar y reanudar el seguimiento

Pausa CodeBender cuando quieras realizar ediciones manuales que no deban convertirse automáticamente en nuevos bloques de revisión.

Al reanudar, las ediciones realizadas durante la pausa pueden incorporarse al baseline según la estrategia de conflictos configurada.

Estrategias disponibles:

- `ask`
- `keep-pending`
- `absorb-all`

---

## Sesiones de revisión

La vista **Review Sessions** conserva resúmenes ligeros como:

- decisiones aceptadas;
- decisiones rechazadas;
- decisiones staged;
- feedback enviado;
- operaciones de undo;
- archivos pendientes al finalizar una sesión.

La sesión activa se persiste para que CodeBender pueda recuperar su estado después de reiniciar VS Code.

---

## Instalación

### Instalar el VSIX empaquetado

1. Descarga `codebender-0.7.2.vsix`.
2. Abre VS Code.
3. Presiona `Ctrl+Shift+P`.
4. Ejecuta **Extensions: Install from VSIX...**.
5. Selecciona `codebender-0.7.2.vsix`.
6. Ejecuta **Developer: Reload Window** si VS Code lo solicita.

Desde una terminal con el CLI de VS Code:

```bash
code --install-extension codebender-0.7.2.vsix
```

### Actualizar desde una versión anterior

Instala el nuevo VSIX sobre la extensión existente y recarga VS Code.

Antes de probar una build de desarrollo en repositorios importantes, sigue siendo recomendable contar con un commit Git normal o una copia de seguridad independiente.

### Ejecutar desde el código fuente

```bash
git clone <tu-repositorio-codebender>
cd codebender
npm run check
code .
```

Luego presiona `F5` para lanzar un Extension Development Host.

El paquete fuente 0.7.2 incluye el código de la extensión, el script de validación y pruebas automatizadas de regresión en Node. Ejecuta `npm test` para correrlas.

---

## Inicio rápido

1. Abre una carpeta de proyecto en VS Code.
2. Abre la vista **CodeBender** de la Activity Bar.
3. Pulsa **Start Review Session**.
4. Si Git está disponible y `codeBender.git.fastBaseline` está activado, CodeBender inicia el baseline Git-first.
5. Permite que Claude Code u otro agente modifique el workspace.
6. Abre un archivo fuente cambiado.
7. Revisa los bloques inline con **Aceptar**, **Aceptar + Stage**, **Rechazar** o **Solicitar corrección**.
8. Navega por los cambios restantes desde el editor o las vistas de CodeBender.
9. Finaliza la sesión cuando hayas resuelto los cambios previstos.
10. Haz commit con tu flujo Git normal cuando corresponda.

---

## Flujo recomendado con Claude Code

```text
Abrir repositorio Git
        ↓
Iniciar sesión de revisión CodeBender
        ↓
Seleccionar fuente: Claude Code
        ↓
Claude modifica archivos
        ↓
CodeBender marca bloques inline
        ↓
┌───────────────────────────────┐
│ ✓ Aceptar                     │
│ ⎇ Aceptar + Stage            │
│ ↶ Rechazar                    │
│ 💬 Solicitar corrección       │
└───────────────────────────────┘
        ↓
Claude puede corregir el bloque rechazado
        ↓
revisar bloques restantes
        ↓
pruebas / build
        ↓
Git commit
```

---

## Configuración

| Setting | Predeterminado | Propósito |
|---|---:|---|
| `codeBender.excludeGlob` | carpetas generadas/dependencias | Rutas excluidas del fallback de snapshots y escaneo |
| `codeBender.maxFileSizeMB` | `10` | Tamaño máximo gestionado para backup/restauración |
| `codeBender.maxFiles` | `20000` | Máximo de archivos considerados en una sesión |
| `codeBender.confirmReject` | `true` | Conservado para compatibilidad con comandos heredados de rechazo masivo/archivo |
| `codeBender.inlineReview.enabled` | `true` | Activa la revisión inline por bloques |
| `codeBender.inlineReview.showCodeLens` | `true` | Muestra controles sobre los hunks |
| `codeBender.inlineReview.maxLines` | `25000` | Límite de líneas para diff inline |
| `codeBender.explorer.badges` | `true` | Muestra badges de cambios pendientes |
| `codeBender.git.enabled` | `true` | Activa checkpoints e integración de staging |
| `codeBender.git.fastBaseline` | `true` | Usa baseline Git-first perezoso cuando está disponible |
| `codeBender.git.checkpointOnDecision` | `false` | Crea checkpoint tras cada decisión de revisión |
| `codeBender.git.maxCheckpoints` | `100` | Máximo de checkpoints mostrados por sesión |
| `codeBender.git.historyLimit` | `20` | Commits Git recientes mostrados |
| `codeBender.pause.conflictStrategy` | `ask` | Resuelve ediciones realizadas durante una pausa |
| `codeBender.agent.default` | `ask` | Agente/adaptador predeterminado |
| `codeBender.agent.autoCreateTerminal` | `false` | Crea una terminal del agente si no existe |
| `codeBender.agent.executePrompt` | `false` | Presiona Enter automáticamente tras insertar feedback |
| `codeBender.agent.contextMode` | `block+context` | Contexto de feedback: bloque, contexto cercano o archivo |
| `codeBender.agent.contextLines` | `40` | Cantidad de líneas de contexto cercano |
| `codeBender.agent.maxFragmentChars` | `12000` | Longitud máxima del fragmento enviado al agente |

### Configuración recomendada de rendimiento

Para repositorios Git normales:

```json
{
  "codeBender.git.enabled": true,
  "codeBender.git.fastBaseline": true,
  "codeBender.git.checkpointOnDecision": false,
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true
}
```

---

## Modelo de rendimiento

### Repositorio Git

Ruta preferida en 0.7.0:

```text
Iniciar sesión
   ↓
detectar Git
   ↓
resolver baseline
   ↓
vigilar cambios relevantes
   ↓
cargar baseline de forma perezosa por archivo cambiado
```

Esto evita el patrón anterior de leer, hashear y escribir de forma anticipada una copia física de todos los archivos del repositorio.

### Carpeta sin Git

Ruta de fallback:

```text
Iniciar sesión
   ↓
crear almacenamiento de snapshots de forma segura
   ↓
escanear archivos permitidos
   ↓
guardar snapshots baseline
   ↓
vigilar cambios
```

Para obtener mejor rendimiento en proyectos sin Git, mantén excluidas dependencias y carpetas generadas.

---

## Privacidad y seguridad

CodeBender está diseñado con enfoque local-first:

- no requiere backend propio de CodeBender;
- la extensión no implementa un servicio de telemetría de CodeBender;
- CodeBender no necesita una API key de IA;
- los baselines Git-first se almacenan mediante objetos Git locales y referencias internas;
- los snapshots de archivos se usan como fallback para carpetas sin Git o no cubiertas;
- el feedback al agente se envía únicamente a la terminal integrada seleccionada o al adaptador CLI configurado;
- los checkpoints utilizan índices Git temporales en lugar de reemplazar el índice normal del usuario.

El agente de programación puede tener sus propias políticas de red, telemetría, retención y privacidad. CodeBender no modifica las garantías de privacidad de Claude Code, Codex, Kimi Code, Gemini CLI, OpenCode o herramientas personalizadas.

---

## Modelo de seguridad

### No requiere comandos Git destructivos para la revisión normal

El diseño evita depender de operaciones amplias como:

```text
git reset --hard
git clean -fd
git checkout .
```

para decisiones normales por bloque.

### Trabajo staged existente

La creación de checkpoints usa un índice aislado. `Aceptar + Stage` es diferente: apunta intencionalmente al índice Git real, por lo que CodeBender valida la compatibilidad del baseline antes de preparar el cambio.

### Sigue siendo recomendable una copia independiente

CodeBender es una extensión en etapa temprana. Git sigue siendo el sistema principal de control de versiones y el trabajo importante debe estar commiteado o respaldado de forma independiente antes de probar builds de desarrollo.

---

## Solución de problemas

### El inicio de sesión fallaba con `ENOENT ... /snapshots/*.bin`

El fallback de snapshots de 0.7.0 inicializa sus directorios antes de comenzar el trabajo concurrente. En repositorios Git, el baseline rápido también evita crear snapshots completos en la ruta normal.

Después de actualizar:

1. Instala `codebender-0.7.2.vsix`.
2. Ejecuta **Developer: Reload Window**.
3. Abre un proyecto respaldado por Git.
4. Inicia una nueva sesión de revisión.
5. Mantén activado `codeBender.git.fastBaseline`.

### El inicio sigue siendo lento

Comprueba que el workspace realmente esté dentro de un repositorio Git.

Para repositorios Git:

```json
{
  "codeBender.git.enabled": true,
  "codeBender.git.fastBaseline": true
}
```

Para carpetas sin Git, revisa `codeBender.excludeGlob` y evita incluir dependencias o builds.

### No aparecen los controles inline

Verifica:

```json
{
  "codeBender.inlineReview.enabled": true,
  "codeBender.inlineReview.showCodeLens": true
}
```

Guarda el archivo modificado y ejecuta **CodeBender: Refresh Changes** si es necesario.

### Un archivo eliminado no tiene botones inline

Un archivo eliminado ya no tiene un documento actual que pueda decorarse. Los archivos eliminados siguen siendo revisables desde la vista lateral de CodeBender.

### `Aceptar + Stage` es rechazado

Es intencional cuando el índice Git existente no coincide con el baseline de revisión. Esta validación evita sobrescribir trabajo staged previo de forma ambigua.

---

## Limitaciones conocidas

- La UI inline privada que usa internamente GitHub Copilot no es un componente público reutilizable de VS Code. CodeBender reproduce el flujo mediante APIs públicas como CodeLens, decoraciones del editor, íconos del gutter, Tree Views, decoraciones de archivos, terminales y Git.
- La atribución de cambios es best-effort y no criptográficamente confiable.
- Los binarios y archivos por encima de los límites configurados pueden manejarse a nivel de archivo y no de líneas/hunks.
- Los archivos eliminados no pueden mostrar controles inline en un documento que ya no existe.
- `Aceptar + Stage` rechaza intencionalmente estados ambiguos del índice.
- Los workspaces multi-root pueden usar una combinación de raíces Git y raíces respaldadas por snapshots.

---

## Arquitectura

```text
VS Code Extension Host
│
├── Motor de sesión / baseline
│   ├── baseline Git-first perezoso
│   ├── fallback de snapshots sin Git
│   ├── caché de contenido baseline
│   ├── motor de hunks
│   └── pausa / reanudación
│
├── UX de revisión inline
│   ├── acciones CodeLens
│   ├── marcadores en gutter
│   ├── decoraciones de líneas
│   ├── badges del Explorador
│   ├── Review Changes
│   └── Review Sessions
│
├── Integración Git
│   ├── checkpoints con índice temporal
│   ├── referencias internas
│   ├── Git Timeline
│   ├── staging parcial seguro
│   └── rollback de decisiones
│
└── Adaptadores de agentes
    ├── Claude Code
    ├── Codex
    ├── Kimi Code
    ├── Gemini CLI
    ├── OpenCode
    ├── Terminal activa
    └── CLI personalizado
```

CodeBender no tiene dependencias npm en runtime.

---

## Desarrollo

Valida la sintaxis JavaScript con:

```bash
npm run check
```

El paquete fuente 0.7.2 incluye pruebas automatizadas Node para independencia de hunks y staging parcial de Git. Ejecuta `npm test` para correrlas.

Flujo de desarrollo recomendado:

```bash
npm run check
code .
```

Luego presiona `F5` para ejecutar un Extension Development Host y prueba el flujo en un repositorio Git desechable.

---

## Estado del proyecto

CodeBender es un proyecto open source en etapa temprana. La versión 0.7.2 está orientada a pruebas e iteración activa. Utiliza commits Git normales u otra copia independiente para trabajo importante mientras evalúas builds de desarrollo.

## Roadmap

- hilos de feedback inline más ricos;
- interacción todavía más cercana a Copilot usando APIs públicas de VS Code;
- mejor detección automática de turnos del agente cuando sea posible;
- fallback sin Git todavía más rápido;
- mejor experiencia en workspaces multi-root;
- validación de tests/build asociada a bloques aceptados;
- generación de mensajes de commit desde el historial de revisión aceptado;
- reportes por sesión de cambios aceptados/rechazados;
- capa opcional de adaptadores MCP;
- extracción de contexto más consciente del lenguaje;
- empaquetado para Marketplace y automatización de releases.

## Contribuir

Issues y pull requests son bienvenidos. Consulta [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licencia

MIT. Consulta [`LICENSE`](LICENSE).

## Marca / afiliación

CodeBender es un proyecto open source independiente. No está afiliado ni respaldado por GitHub, Microsoft, Anthropic, OpenAI, Moonshot AI, Google u OpenCode.
