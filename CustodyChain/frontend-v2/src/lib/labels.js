export const CLASS_LABEL = {
  SCENE_PHOTOGRAPH: 'Scene photograph', AV_RECORDING: 'A/V recording', CCTV_EXPORT: 'CCTV export',
  PHYSICAL_DOCUMENT: 'Physical document', PHYSICAL_ITEM: 'Physical item', BIO_TRACE_SAMPLE: 'Biological / trace sample',
  DIGITAL_DEVICE: 'Digital device', FORENSIC_IMAGE: 'Forensic image', MOBILE_EXTRACTION: 'Mobile extraction',
  CLOUD_DATA: 'Cloud data', IOT_LOG: 'IoT log', PROCEDURAL_DOCUMENT: 'Procedural document',
};
export const STATUS_STYLE = {
  IN_CUSTODY: 'bg-ok-50 text-ok-700 ring-ok-600/30', IN_TRANSFER: 'bg-seal-50 text-seal-600 ring-seal-400/40',
  UNDER_EXAMINATION: 'bg-ink-100 text-ink-700 ring-ink-400/40', ARCHIVED: 'bg-ink-100 text-ink-600 ring-ink-400/30',
  RETURNED: 'bg-ink-100 text-ink-600 ring-ink-400/30', DISPOSED: 'bg-bad-50 text-bad-700 ring-bad-600/30',
};
export const EVENT_LABEL = {
  REGISTER: 'Registered', DERIVE: 'Derived item created', TRANSFER_INITIATE: 'Transfer initiated', TRANSFER_ACCEPT: 'Transfer accepted',
  TRANSFER_REJECT: 'Transfer rejected', TRANSFER_CANCEL: 'Transfer cancelled', ACCESS: 'Accessed', SEAL: 'Sealed', RESEAL: 'Resealed',
  EXAMINE_START: 'Examination started', EXAMINE_END: 'Examination completed', VERIFY_INTEGRITY: 'Integrity verified',
  VERIFY_IDENTITY: 'Identity verified', SUBMIT_COURT: 'Submitted in court', RETURN: 'Returned', ARCHIVE: 'Archived',
  DISPOSE: 'Disposed', CORRECTION: 'Correction',
};
export const ORG_SHORT = { PoliceMSP: 'Police', FSLMSP: 'FSL', CourtMSP: 'Court' };
