export const FILE_OPEN_LABEL = "Datei öffnen";

export function isOccupancyIdle(options: {
  scanning: boolean;
  exportBusy: boolean;
  preparingContent: boolean;
}): boolean {
  return !options.scanning && !options.exportBusy && !options.preparingContent;
}

export function canOpenWithDefault(options: {
  hasCurrentScan: boolean;
  isFileSelected: boolean;
  occupancyIdle: boolean;
}): boolean {
  return options.hasCurrentScan && options.isFileSelected && options.occupancyIdle;
}
