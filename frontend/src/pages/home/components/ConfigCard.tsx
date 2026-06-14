import { Tab, Tabs } from '@blueprintjs/core';
import { useState } from 'react';

import type { ConfigData } from '../HomePage.tsx';

import DeviceConfigSection from './DeviceConfigSection.tsx';
import BatteryControlSection from './config/BatteryControlSection.tsx';
import BatteryReserveSection from './config/BatteryReserveSection.tsx';
import DataSourcesSection from './config/DataSourcesSection.tsx';
import DatabaseSection from './config/DatabaseSection.tsx';
import SolarPanelsSection from './config/SolarPanelsSection.tsx';
import SolarWebSection from './config/SolarWebSection.tsx';
import WeatherSection from './config/WeatherSection.tsx';

interface ConfigCardProps {
  config: ConfigData;
  onConfigChange: (updated: ConfigData) => void;
  modbusStatus: 'ok' | 'error' | 'disabled';
  modbusError: string | null;
}

export default function ConfigCard({
  config,
  onConfigChange,
  modbusStatus,
  modbusError,
}: ConfigCardProps) {
  const [selectedTab, setSelectedTab] = useState(
    () => localStorage.getItem('solar-config-tab') ?? 'panels',
  );

  return (
    <div className="card">
      <span className="card-title">Configuration</span>
      <Tabs
        id="config-tabs"
        className="config-tabs"
        selectedTabId={selectedTab}
        onChange={(id) => {
          const tab = String(id);
          setSelectedTab(tab);
          localStorage.setItem('solar-config-tab', tab);
        }}
        vertical
        renderActiveTabPanelOnly
      >
        <Tab
          id="panels"
          title="Solar Panels"
          panel={
            <SolarPanelsSection
              config={config}
              onConfigChange={onConfigChange}
            />
          }
        />
        <Tab
          id="sources"
          title="Data Sources"
          panel={
            <DataSourcesSection
              config={config}
              modbusStatus={modbusStatus}
              modbusError={modbusError}
            />
          }
        />
        <Tab
          id="solarweb"
          title="SolarWeb"
          panel={
            <SolarWebSection config={config} onConfigChange={onConfigChange} />
          }
        />
        <Tab id="weather" title="Weather" panel={<WeatherSection />} />
        <Tab
          id="control"
          title="Battery Control"
          panel={<BatteryControlSection />}
        />
        <Tab
          id="reserve"
          title="Battery Reserve"
          panel={
            <BatteryReserveSection
              config={config}
              onConfigChange={onConfigChange}
            />
          }
        />
        <Tab id="devices" title="Devices" panel={<DeviceConfigSection />} />
        <Tab id="database" title="Database" panel={<DatabaseSection />} />
      </Tabs>
    </div>
  );
}
