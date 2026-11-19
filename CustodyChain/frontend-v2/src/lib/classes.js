// Form definitions for the evidence classes offered in the UI (D-033: four classes in the UI; the API accepts all 12).
// Field keys are paths inside `class_attributes` of the manifest (outputs/spec/evidence-manifest.schema.json).
// type: text | int | decimal | bool | select | list (comma-separated -> array)

const DEVICE_TYPES = ['Computer/Storage Media', 'DVR', 'Mobile', 'Flash Drive', 'CD/DVD', 'Server', 'Other'];

export const CLASSES = {
  SCENE_PHOTOGRAPH: {
    label: 'Scene photograph',
    blurb: 'A photograph taken at the scene. The original file is the evidence; it is hashed exactly as the camera wrote it.',
    fields: [
      { key: 'subject', label: 'What the photograph shows', type: 'text', required: true, placeholder: 'Knife near stain (marker 1)' },
      { key: 'photo_series_id', label: 'Photo series ID', type: 'text', required: true, placeholder: 'SOC-123-2026-A' },
      { key: 'frame_number', label: 'Frame number in series', type: 'int', required: true, default: '1' },
      { key: 'view', label: 'View', type: 'select', required: true, options: ['overall', 'mid-range', 'close-up', 'aerial', 'entry-exit'], default: 'overall' },
      { key: 'scale_present', label: 'Scale / ruler in frame', type: 'bool', default: true },
      { key: 'colour_reference_present', label: 'Colour reference in frame', type: 'bool', default: false },
      { key: 'original_format', label: 'Original format', type: 'select', options: ['JPEG', 'HEIC', 'RAW-DNG', 'RAW-VENDOR', 'PNG', 'TIFF'], default: 'JPEG' },
      { key: 'flash', label: 'Flash used', type: 'bool', default: false },
    ],
    files: [{ slot: 'photo', role: 'scene_photo', label: 'Original photograph file (do not edit or re-save)', accept: 'image/*', multiple: false, required: true }],
  },
  PHYSICAL_DOCUMENT: {
    label: 'Physical document',
    blurb: 'A recovered notebook, letter or ledger. Paper cannot be hashed: every side is scanned losslessly and the scans are fingerprinted in page order.',
    fields: [
      { key: 'document_type', label: 'Document type', type: 'text', required: true, placeholder: 'spiral notebook' },
      { key: 'leaf_count', label: 'Number of leaves', type: 'int' },
      { key: 'dimensions_mm.width', label: 'Width (mm)', type: 'decimal', required: true },
      { key: 'dimensions_mm.height', label: 'Height (mm)', type: 'decimal', required: true },
      { key: 'dimensions_mm.thickness', label: 'Thickness (mm)', type: 'decimal' },
      { key: 'binding', label: 'Binding', type: 'text', required: true, placeholder: 'metal spiral, left edge' },
      { key: 'writing_media', label: 'Writing media (comma-separated)', type: 'list', placeholder: 'blue ballpoint, pencil' },
      { key: 'distinguishing_features', label: 'Distinguishing features (comma-separated)', type: 'list', required: true, placeholder: 'ring stain on cover, torn corner on page 3' },
      { key: 'scan_dpi', label: 'Scan resolution (dpi, at least 300)', type: 'int', required: true, default: '300' },
      { key: 'scan_colour_mode', label: 'Scan colour mode', type: 'select', options: ['RGB-24', 'RGB-48', 'GRAY-8', 'GRAY-16'], default: 'RGB-24', required: true },
      { key: 'scan_file_format', label: 'Scan file format', type: 'select', options: ['PNG', 'TIFF'], default: 'PNG' },
    ],
    files: [
      { slot: 'cover', role: 'cover_photo', label: 'Cover / edge photographs', accept: 'image/*', multiple: true, required: false },
      { slot: 'pages', role: 'page_scan', label: 'Page scans, in page order (lossless PNG/TIFF)', accept: 'image/png,image/tiff', multiple: true, required: true, countsAs: 'page_count' },
    ],
  },
  PHYSICAL_ITEM: {
    label: 'Physical item',
    blurb: 'A weapon, garment, tool or other object. Photographs and an optional 3D scan form the reference capture for later identity checks.',
    fields: [
      { key: 'item_category', label: 'Item category', type: 'text', required: true, placeholder: 'edged weapon' },
      { key: 'dimensions_mm.length', label: 'Length (mm)', type: 'decimal', required: true },
      { key: 'dimensions_mm.width', label: 'Width (mm)', type: 'decimal' },
      { key: 'dimensions_mm.height', label: 'Height (mm)', type: 'decimal' },
      { key: 'mass.value', label: 'Mass', type: 'decimal' },
      { key: 'mass.unit', label: 'Mass unit', type: 'select', options: ['g', 'kg'], default: 'g', dependsOn: 'mass.value' },
      { key: 'material', label: 'Material', type: 'text', required: true },
      { key: 'colour', label: 'Colour', type: 'text' },
      { key: 'serial_or_make_marks', label: 'Serial number / make marks', type: 'text' },
      { key: 'unique_marks', label: 'Unique marks (comma-separated)', type: 'list', required: true, placeholder: 'scratch near heel, chip in handle' },
      { key: 'scan_3d.method', label: '3D scan method', type: 'select', required: true, options: ['structured-light', 'laser', 'photogrammetry', 'lidar', 'not-performed'], default: 'not-performed' },
      { key: 'scan_3d.point_spacing_mm', label: '3D point spacing (mm)', type: 'decimal', required: true, default: '0' },
      { key: 'scan_3d.stated_accuracy_mm', label: '3D stated accuracy (mm)', type: 'decimal', required: true, default: '0' },
      { key: 'scan_3d.reason_not_performed', label: 'Reason 3D scan not performed', type: 'text' },
      { key: 'expected_changes', label: 'Expected changes during examination (comma-separated)', type: 'list', placeholder: 'swabbing of stains' },
    ],
    files: [
      { slot: 'photos', role: 'closeup_photo', label: 'Photographs (all views, with scale)', accept: 'image/*', multiple: true, required: true },
      { slot: 'scan3d', role: 'scan_3d', label: '3D scan (PLY / OBJ / STL), optional', accept: '.ply,.obj,.stl', multiple: false, required: false, mediaType: 'model/ply' },
    ],
  },
  DIGITAL_DEVICE: {
    label: 'Digital device',
    blurb: 'A seized phone, laptop or storage device. The device is documented here; its data is fingerprinted separately when it is imaged.',
    fields: [
      { key: 'device_type', label: 'Device type (BSA Schedule)', type: 'select', required: true, options: DEVICE_TYPES, default: 'Mobile' },
      { key: 'make_model', label: 'Make & model', type: 'text', required: true },
      { key: 'colour', label: 'Colour', type: 'text' },
      { key: 'serial_number', label: 'Serial number', type: 'text', required: true },
      { key: 'imei_uin_uid_mac', label: 'IMEI / UIN / UID / MAC (comma-separated)', type: 'list' },
      { key: 'sim_iccids', label: 'SIM ICCIDs (comma-separated)', type: 'list' },
      { key: 'power_state_at_seizure', label: 'Power state at seizure', type: 'select', required: true, options: ['on-unlocked', 'on-locked', 'off', 'unknown'], default: 'on-locked' },
      { key: 'isolation', label: 'Network isolation', type: 'select', required: true, options: ['faraday-bag', 'airplane-mode', 'powered-off', 'none'], default: 'faraday-bag' },
      { key: 'lock_status', label: 'Lock status (never record the passcode)', type: 'select', options: ['no-lock', 'locked-credential-known', 'locked-credential-unknown'], default: 'locked-credential-unknown' },
    ],
    files: [{ slot: 'photos', role: 'overview_photo', label: 'Photographs of the device, screen and labels', accept: 'image/*', multiple: true, required: true }],
  },
};

export const LEGAL_BASES = ['BNSS s.105 search and seizure', 'BNSS s.185 search by police officer', 'BNSS s.176(3) scene of crime (forensic team)',
  'BNSS s.94 production of documents / electronic records', 'Voluntary production by owner'];
export const CAPTURE_DEVICES = ['Mobile', 'Camera', 'Flatbed Scanner', '3D Scanner', 'Computer/Storage Media', 'Other'];

function setPath(obj, key, val) {
  const parts = key.split('.');
  let o = obj;
  parts.slice(0, -1).forEach((p) => { o[p] = o[p] || {}; o = o[p]; });
  o[parts[parts.length - 1]] = val;
}

// Turn the raw form values into the class_attributes object the schema expects.
export function buildClassAttributes(cls, values, fileCounts) {
  const out = {};
  for (const f of CLASSES[cls].fields) {
    let v = values[f.key];
    if (f.dependsOn && (values[f.dependsOn] === '' || values[f.dependsOn] === undefined)) continue;
    if (f.type === 'bool') { setPath(out, f.key, !!v); continue; }
    if (v === undefined || v === null || String(v).trim() === '') continue;
    v = String(v).trim();
    if (f.type === 'int') v = parseInt(v, 10);
    else if (f.type === 'decimal') v = v.replace(/,/g, '');
    else if (f.type === 'list') v = v.split(',').map((x) => x.trim()).filter(Boolean);
    setPath(out, f.key, v);
  }
  for (const slot of CLASSES[cls].files) if (slot.countsAs) out[slot.countsAs] = fileCounts[slot.slot] || 0;
  return out;
}
