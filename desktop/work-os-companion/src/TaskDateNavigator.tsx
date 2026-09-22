import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatWorkOsDate, shiftWorkOsDate } from "./dateFormat";

export function TaskDateNavigator({ currentDate, selectedDate, onDate }: {
  currentDate: string;
  selectedDate: string;
  onDate: (date: string) => void | Promise<void>;
}) {
  if (!currentDate || !selectedDate) return null;

  return <nav className="date-navigator" aria-label="Tasks date navigation">
    <button type="button" aria-label="Previous day" onClick={() => void onDate(shiftWorkOsDate(selectedDate, -1))}><ChevronLeft size={16} /></button>
    <label className="formatted-date-picker"><span>{formatWorkOsDate(selectedDate)}</span><input aria-label="Workspace date" type="date" max={currentDate} value={selectedDate} onChange={(event) => void onDate(event.target.value)} /></label>
    <button type="button" aria-label="Next day" disabled={selectedDate >= currentDate} onClick={() => void onDate(shiftWorkOsDate(selectedDate, 1))}><ChevronRight size={16} /></button>
  </nav>;
}
