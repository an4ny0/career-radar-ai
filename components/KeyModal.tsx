"use client";

interface KeyModalProps {
  open: boolean;
  currentKey: string;
  onClose: () => void;
  onSave: (key: string) => void;
  onClear: () => void;
}

export default function KeyModal({ open, currentKey, onClose, onSave, onClear }: KeyModalProps) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="keyTitle" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="key-modal">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <span className="index-chip-light">CONNECTOR SETTINGS</span>
        <h2 id="keyTitle">Connect TinyFish</h2>
        <p className="lede">Your key is held in this browser session and sent to the demo server only when you search. It’s never stored anywhere else.</p>
        <label className="field-label" htmlFor="apiKeyInput">TINYFISH API KEY</label>
        <input
          className="glass-input"
          id="apiKeyInput"
          type="password"
          autoComplete="off"
          placeholder="Paste your key here"
          defaultValue={currentKey}
          key={currentKey}
          onChange={event => {
            if (event.target.value.trim()) return;
            onClear();
          }}
        />
        <div className="modal-actions">
          <button className="ghost-btn" onClick={onClear}>CLEAR KEY</button>
          <button
            className="btn-primary"
            onClick={event => {
              const input = (event.currentTarget.closest(".key-modal")?.querySelector("#apiKeyInput") as HTMLInputElement | null);
              const value = input?.value.trim() || "";
              if (!value) return;
              onSave(value);
            }}
          >
            Save for this session ↗
          </button>
        </div>
        <a className="modal-link" href="https://agent.tinyfish.ai/api-keys" target="_blank" rel="noreferrer">Manage your TinyFish API key ↗</a>
      </div>
    </div>
  );
}
