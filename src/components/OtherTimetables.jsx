import { useState } from 'react';
import { Modal } from './ClassSelector.jsx';
import { IconBack, IconPlus, IconEdit, IconTrash, IconCheck, IconX } from './Icons.jsx';

export default function OtherTimetables({ profiles, onView, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const available = profiles.find((profile) => !profile.classes.length && !profile.name);
  const saved = profiles.filter((profile) => profile.classes.length || profile.name);
  return <Modal title={deleting ? 'Delete timetable?' : draft ? draft.isNew ? 'Add another timetable' : 'Change timetable name' : 'Other timetables'} onClose={onClose}>
    {deleting ? <div className="other-timetables"><p>Delete “{deleting.name || `Saved timetable ${deleting.id}`}” and its saved classes? Your own timetable will stay unchanged.</p><div className="other-editor-actions">
      <button type="button" className="btn btn-ghost btn-icon" aria-label="Cancel deletion" title="Cancel" onClick={() => setDeleting(null)}><IconX /></button>
      <button type="button" className="btn btn-danger btn-icon" aria-label="Confirm delete timetable" title="Delete timetable" onClick={() => { onDelete(deleting.id); setDeleting(null); }}><IconTrash /></button>
    </div></div> : !draft ? <div className="other-timetables">
      <button type="button" className="other-profile" onClick={() => onView('main')}><strong>My timetable</strong></button>
      {saved.map((profile) => <div className="other-profile-row" key={profile.id}>
        <button type="button" className="other-profile" onClick={() => onView(profile.id)}><strong>{profile.name || `Saved timetable ${profile.id}`}</strong></button>
        <button type="button" className="btn btn-ghost btn-icon" title="Rename timetable" onClick={() => setDraft({ id: profile.id, name: profile.name, isNew: false })} aria-label={`Rename ${profile.name || `saved timetable ${profile.id}`}`}><IconEdit /></button>
        <button type="button" className="btn btn-ghost btn-icon delete-timetable" title="Delete timetable" onClick={() => setDeleting(profile)} aria-label={`Delete ${profile.name || `saved timetable ${profile.id}`}`}><IconTrash /></button>
      </div>)}
      <button type="button" className="btn btn-primary btn-icon" aria-label="Add another timetable" title="Add another timetable" disabled={!available} onClick={() => setDraft({ id: available.id, name: '', isNew: true })}><IconPlus /></button>
      {!available && <p className="other-hint">All 10 timetables are in use. Delete one to add another.</p>}
    </div> : <form className="other-editor" onSubmit={(event) => { event.preventDefault(); onSave(draft); if (!draft.isNew) setDraft(null); }}>
      <label>Timetable name<input required maxLength={60} value={draft.name} placeholder="e.g. Ali’s timetable" onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <div className="other-editor-actions"><button type="button" className="btn btn-ghost btn-icon" aria-label="Back" title="Back" onClick={() => setDraft(null)}><IconBack /></button><button type="submit" className="btn btn-primary btn-icon" aria-label={draft.isNew ? 'Create timetable' : 'Save name'} title={draft.isNew ? 'Create timetable' : 'Save name'} disabled={!draft.name.trim()}><IconCheck /></button></div>
    </form>}
  </Modal>;
}
