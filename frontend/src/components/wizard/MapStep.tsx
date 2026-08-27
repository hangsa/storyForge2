import { useWizard } from "./WizardContext";

export default function MapStep() {
  const wizard = useWizard();

  return (
    <div data-testid="map-step" className="text-center py-12 space-y-6">
      <span className="material-symbols-outlined text-6xl text-on-surface-variant/30 block">map</span>
      <div>
        <h2 className="font-display text-primary text-xl mb-2">地图系统</h2>
        <p className="font-body text-body-md text-on-surface-variant text-sm max-w-md mx-auto">
          地图系统功能即将推出，可在工作台内补做此步。当前可跳过。
        </p>
      </div>
      <button
        data-testid="map-skip"
        onClick={() => wizard.skipStep(4)}
        className="px-5 py-2 bg-surface-container text-primary text-sm rounded-lg border border-outline-variant hover:border-primary-container transition-colors"
      >
        跳过
      </button>
    </div>
  );
}