# Exposición de pruebas — Jeff, Sam y Mel

Material autocontenido para preparar y compartir la exposición de pruebas de software.

## Contenido

- `Guion_Ultradetallado_Exposicion_Jeff_Sam_Mel.docx`: documento editable.
- `Guion_Ultradetallado_Exposicion_Jeff_Sam_Mel.pdf`: versión de lectura de 73 páginas.
- `Paquete_Guion_Jeff_Sam_Mel.zip`: paquete con el DOCX, el PDF y los tres grafos Mermaid.
- `mermaid/grafo_jeff_auth_login.mmd`: grafo de `AuthService.login()`.
- `mermaid/grafo_sam_notify_students.mmd`: grafo de `AttendanceRiskService.notifyStudents()`.
- `mermaid/grafo_mel_update_mine.mmd`: grafo de `NetworkingService.updateMine()`.

Los archivos `.mmd` pueden abrirse en VS Code con una extensión de vista previa de Mermaid o pegarse en un editor compatible.

## Evidencia de mutación actual

| Integrante | Resultado verificable |
|---|---:|
| Jeff | 47 killed / 47 válidos, 0 survived |
| Sam | 156 killed, 0 survived, 2 ignored equivalentes |
| Mel | 15 killed / 15 válidos, 0 survived |

Los dos mutantes ignorados de Sam corresponden a cambios equivalentes sobre la guarda redundante de lista vacía en `grades.logic.ts`; no se contabilizan como sobrevivientes.

Comandos para regenerar la evidencia desde la raíz del backend:

```bash
bun run mut:jeff
bun run mut:sam
bun run mut:mel
```
