import type { Item } from "@shared/view.ts";
import type { CSSProperties } from "react";
import { Check } from "../icons.tsx";
import { toggleChecked } from "../lib/actions.ts";
import { useLongPress } from "../lib/useLongPress.ts";

interface Props {
  item: Item;
  /** Farbe des „nur hier“-Punkts, falls der Eintrag nur in diesem Geschäft gekauft wird. */
  dotColor?: string;
  /** Name, wer abgehakt hat (nur bei anderen Personen). */
  checkedBy?: string;
  onEdit: (entryId: string) => void;
}

/** Eine Zeile: Tippen hakt ab, langes Drücken öffnet das Bearbeiten-Menü. */
export function ItemRow({ item, dotColor, checkedBy, onEdit }: Props) {
  const { entry, product } = item;
  const press = useLongPress(() => onEdit(entry.id), () => toggleChecked(entry));
  return (
    <button className="row" aria-pressed={entry.checked} aria-description="Lange drücken zum Bearbeiten" {...press}>
      <span className="check">{entry.checked && <Check />}</span>
      <span className="row-main">
        <span className="row-name">{product.name}</span>
        {entry.note && <span className="row-note">{entry.note}</span>}
        {checkedBy && <span className="row-by">von {checkedBy}</span>}
      </span>
      {dotColor && (
        <span className="dot" style={{ "--c": dotColor } as CSSProperties}>
          <span className="sr">gibt's nur hier</span>
        </span>
      )}
      {entry.qty && <span className="row-qty">{entry.qty}</span>}
    </button>
  );
}
