"use client";
import { useState } from "react";
import { Check, Plus } from "lucide-react";
import type { Definition } from "@/lib/types";
import { Dialog } from "./ui";
const categories: Record<string, string> = {
  physique: "체격",
  health_fitness: "건강체력",
  motor_fitness: "운동체력",
};
const factors: Record<string, string> = {
  body_composition: "신체조성",
  strength: "근력",
  muscular_endurance: "근지구력",
  cardiorespiratory_endurance: "심폐지구력",
  flexibility: "유연성",
  agility: "민첩성",
  power: "순발력",
  coordination: "협응력",
};
export function CatalogPicker({
  definitions,
  selected,
  onSelect,
  onClose,
}: {
  definitions: Definition[];
  selected: string[];
  onSelect: (code: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = definitions.filter(
    (d) =>
      d.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()) ||
      (factors[d.factor] ?? "").includes(search),
  );
  const groups = [...new Set(filtered.map((d) => d.category))];
  return (
    <Dialog title="측정 항목 추가" onClose={onClose} sheet>
      <label className="field-label" htmlFor="catalog-search">
        검사명 검색
      </label>
      <input
        className="input catalog-search"
        id="catalog-search"
        placeholder="예: 신장, 유연성"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <p className="caption">결과표와 같은 검사명과 단위를 선택해 주세요.</p>
      {!filtered.length && (
        <p className="catalog-empty">해당하는 검사를 찾지 못했어요.</p>
      )}
      {groups.map((group) => (
        <section className="catalog-group" key={group}>
          <h3>{categories[group] ?? group}</h3>
          {filtered
            .filter((d) => d.category === group)
            .map((d) => (
              <button
                className="catalog-option"
                key={d.code}
                disabled={selected.includes(d.code)}
                onClick={() => {
                  onSelect(d.code);
                  onClose();
                }}
              >
                <div>
                  <strong>{d.label}</strong>
                  <small>
                    {factors[d.factor] ?? d.factor} · {d.unit}
                    {selected.includes(d.code) ? " · 추가됨" : ""}
                  </small>
                </div>
                {selected.includes(d.code) ? (
                  <Check size={19} />
                ) : (
                  <Plus size={19} />
                )}
              </button>
            ))}
        </section>
      ))}
    </Dialog>
  );
}
