import type { ReactNode, Ref } from "react";
import { Icon } from "./icon";

export interface EntryTrial {
  index: number;
  name: string;
  difficulty: string;
  stars: number;
  locked: boolean;
}

interface GameEntryProps {
  titleRef: Ref<HTMLHeadingElement>;
  garage: ReactNode;
  trials: EntryTrial[];
  cleared: number;
  activeIndex: number | null;
  lastUnlocked: number;
  page: number;
  lastPage: number;
  onSelect: (index: number) => void;
  onPage: (page: number) => void;
  onBack: () => void;
}

export function GameEntry({
  titleRef, garage, trials, cleared, activeIndex, lastUnlocked, page, lastPage, onSelect, onPage, onBack,
}: GameEntryProps) {
  return (
    <section className="game-entry" aria-labelledby="entry-title">
      <div className="entry-intro">
        <header>
          <div className="brand">
            <span className="brand-icon"><Icon name="parking" size={28} /></span>
            <h1 id="entry-title" ref={titleRef} tabIndex={-1} translate="no">Parkline</h1>
          </div>
          <p className="header-caption">3D parking trials</p>
        </header>
        {garage}
      </div>
      <section className="entry-trials" aria-labelledby="entry-levels">
        <header className="entry-trial-heading">
          <div><h2 id="entry-levels">Select a level</h2><p className="trial-progress">{cleared} completed</p></div>
          {activeIndex !== null && (
            <button className="utility-button" type="button" aria-label="Back to game" onClick={onBack}><Icon name="back" /></button>
          )}
        </header>
        <button type="button" className="primary trial-continue" onClick={() => onSelect(lastUnlocked)}>
          {lastUnlocked > 0 ? `Continue at trial ${lastUnlocked + 1}` : "Start trial 1"} <Icon name="right" size={18} />
        </button>
        <div className="trial-list">
          {trials.map(({ index, name, difficulty, stars, locked }) => (
            <button type="button" key={index} className="trial" disabled={locked}
              aria-current={index === activeIndex ? "step" : undefined} onClick={() => onSelect(index)}>
              <span className="trial-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="trial-name"><strong>{name}</strong><small>{difficulty}</small></span>
              {locked ? <span className="trial-lock"><Icon name="lock" size={15} /><span className="sr-only">Locked</span></span>
                : <span className="trial-rating">{stars
                  ? <span aria-label={`${stars} of 3 stars`}>{"★".repeat(stars)}</span>
                  : <Icon name="right" size={16} />}</span>}
            </button>
          ))}
        </div>
        {lastPage > 0 && <nav className="trial-navigation" aria-label="Trial pages">
          <button className="utility-button" type="button" aria-label="Previous page of trials" disabled={page === 0}
            onClick={() => onPage(page - 1)}><Icon name="left" size={16} /></button>
          <span aria-live="polite">Trials {page * trials.length + 1}–{(page + 1) * trials.length}</span>
          <button className="utility-button" type="button" aria-label="Next page of trials" disabled={page >= lastPage}
            onClick={() => onPage(page + 1)}><Icon name="right" size={16} /></button>
        </nav>}
      </section>
    </section>
  );
}
