// In-memory fixtures for the local UI harness.
// Shapes are derived from the firmware producers named in each comment and from
// the consuming page JavaScript. They are NOT live controller data.

export function createFixtures() {
  const state = {
    theme: '',
    notes: { dash: 'Dry hopped', room: 'Ferm. Chamber', keg: {} },
    logConfig: {
      enabled: false,
      period: 300,
      url: '',
      format: '',
      method: 'POST',
      type: '',
      service: 3,
    },
  };

  // ScaleManager::statusJson(true)
  const scale = {
    use: true,
    retentionDays: 180,
    eventThresholdGrams: 100,
    maxPourMl: 1500,
    dailyMinute: 60,
    sampleMinutes: 2,
    sampleHours: 24,
    sampleActive: false,
    sampleRemainingSec: 0,
    timeSynced: true,
    scales: [
      {
        id: 0,
        configured: true,
        name: 'Keg scale 1',
        kegName: 'Pale Ale',
        doutPin: 16,
        clockPin: 17,
        calibrated: true,
        calibrationLimitCounts: 5000,
        zeroOffset: 0,
        calibrationFactor: 1040.5,
        emptyKegGrams: 4000,
        capacityMl: 19000,
        beerDensityKgPerL: 1.01,
        tempCorrection: [0, 0, 0, 0],
        state: 3,
        present: true,
        stable: true,
        calibrating: false,
        calCount: 0,
        calTarget: 20,
        calAction: null,
        calError: null,
        calErrorReason: null,
        calResult: null,
        measuring: false,
        measureCount: 0,
        measureTarget: 200,
        measureAction: null,
        measureResult: null,
        measureRecorded: null,
        retryPending: false,
        kegChangePending: false,
        rawCounts: 8123,
        grossGrams: 16400,
        remainingLiters: 12.27,
        capacityLiters: 19,
        percent: 64.6,
        temperatureC: 19.5,
      },
      {
        id: 1,
        configured: false,
        name: '',
        kegName: '',
        doutPin: -1,
        clockPin: -1,
        calibrated: false,
        calibrationLimitCounts: 5000,
        zeroOffset: 0,
        calibrationFactor: 0,
        emptyKegGrams: 0,
        capacityMl: 19000,
        beerDensityKgPerL: 1.01,
        tempCorrection: [0, 0, 0, 0],
        state: 0,
        present: false,
        stable: false,
        calibrating: false,
        calCount: 0,
        calTarget: 20,
        calAction: null,
        calError: null,
        calErrorReason: null,
        calResult: null,
        measuring: false,
        measureCount: 0,
        measureTarget: 200,
        measureAction: null,
        measureResult: null,
        measureRecorded: null,
        retryPending: false,
        kegChangePending: false,
        rawCounts: null,
        grossGrams: null,
        remainingLiters: null,
        capacityLiters: 19,
        percent: 0,
        temperatureC: null,
      },
    ],
  };

  const config = {
    title: 'yeast2tap',
    name: 'yeast2tap',
    user: 'admin',
    pass: '',
    port: 80,
    protect: 0,
    wifi: 0,
    aoff: 15,
    ip: '192.168.1.50',
    gw: '192.168.1.1',
    mask: '255.255.255.0',
    dns: '192.168.1.1',
    glycol: 0,
    duckdnsDomain: '',
    duckdnsToken: '',
    duckdnsInterval: 5,
    duckdnsEnabled: 0,
    theme: '',
    eap: 0,
    dis: 0,
    fid: 123456,
    frsize: 4194304,
    fsize: 4194304,
    fs: 1048576,
    fwsize: 1200000,
    appslot: 1966080,
    appname: 'app0',
    otaslot: 1966080,
    date: 'Oct 31 2026 12:00:00',
    mac: [36, 1, 2, 3, 4, 5],
  };

  const pressure = { a: 123.45, b: 0, mode: 0, psi: 0, adc: 0, gn: 1, a0: 4096 };
  const rh = { m: 0, t: 50, s: 0 };
  // Y2TSettings::defaultGravityConfig(): lpfBeta 0.1, stableThreshold 1.
  // ttce/ttceunit are the SG-tagged correction the page must show and must not
  // silently retag; calbybpl (cal) is off, which is what GravityMon uses.
  const gdc = {
    dev: 0, plato: 0, off: 0, lpc: 0.1, stpt: 1, a0: 0, a1: 1, a2: 0, a3: 0,
    cal: 0, tc: 1, gravitymon: 0, gravitymondetected: 0,
    ttce: [0.006, 0.001, 0, 0], ttceunit: 1,
    calpts: [],
  };
  const ptc = { enabled: false };
  const profile = {
    name: 'Mock ale',
    s: Math.floor(Date.now() / 1000),
    u: 'C',
    t: [
      { c: 't', t: 20, d: 1, g: 1.01 },
      { c: 't', t: 18, d: 3, g: 1.012 },
      { c: 't', t: 16, d: 4, g: 1.008 },
    ],
    tg: 'b',
    hr: 0,
    sp: 0,
  };
  const loglist = {
    fs: { size: 1048576, used: 1024 },
    rec: false,
    log: '',
    start: 0,
    list: [],
    plato: false,
  };
  // ScaleManager::writeDailyJson(255): [day, time, level g, consumed g, flags, scale, raw counts, temperature C].
  // Two kegs over three days; the last record is marked unstable (U).
  const scaleDaily = [
    [20320, 1790000000, 16400, 0, 0, 0, 4120000, 19.5],
    [20320, 1790000000, 12400, 0, 0, 1, 3980000, 19.4],
    [20321, 1790086400, 15200, 1200, 0, 0, 4080000, 19.6],
    [20321, 1790086400, 11800, 600, 0, 1, 3960000, 19.6],
    [20322, 1790172800, 14000, 1200, 0, 0, 4040000, 19.7],
    [20322, 1790172800, 11200, 600, 4, 1, 3940000, 19.7],
  ];
  // Sample-session rows as ScaleManager appends them to the daily file
  // (FlagSample = 32), taken on the evening of the last day above, one per hour.
  // raw = 4000000 + 4000 * (temp - 19.5), so a linear fit of raw on temperature
  // is exact with a slope of 4000 counts/degC. The temperature sweeps 18.5..21.25
  // in 0.25 steps; levels sit below that day's daily record because the keg was
  // pouring between the scheduled measurement and the samples.
  const scaleSamples = [
    [20322, 1790176400, 13980, 0, 32, 0, 3996000, 18.5],
    [20322, 1790180000, 13960, 0, 32, 0, 3997000, 18.75],
    [20322, 1790183600, 13940, 0, 32, 0, 3998000, 19.0],
    [20322, 1790187200, 13920, 0, 32, 0, 3999000, 19.25],
    [20322, 1790190800, 13900, 0, 32, 0, 4000000, 19.5],
    [20322, 1790194400, 13880, 0, 32, 0, 4001000, 19.75],
    [20322, 1790198000, 13860, 0, 32, 0, 4002000, 20.0],
    [20322, 1790201600, 13840, 0, 32, 0, 4003000, 20.25],
    [20322, 1790205200, 13820, 0, 32, 0, 4004000, 20.5],
    [20322, 1790208800, 13800, 0, 32, 0, 4005000, 20.75],
    [20322, 1790212400, 13780, 0, 32, 0, 4006000, 21.0],
    [20322, 1790216000, 13760, 0, 32, 0, 4007000, 21.25],
  ];
  // yeast2tap.cpp GET /getstatus: grouped read-only status for external clients.
  const getstatus = {
    mode: 'o',
    state: 0,
    temperature: {
      beer: 20,
      beerSet: 20,
      fridge: 4.5,
      fridgeSet: 4,
      room: 19.5,
      unit: 'C',
    },
    control: {
      heaterSet: null,
      heaterActive: false,
      heaterPassive: true,
      coolerActive: false,
      coolerPassive: true,
    },
    sensors: {
      beer: { connected: true, lastUpdate: 1790000000 },
      fridge: { connected: true, lastUpdate: 1790000000 },
      room: { connected: false, lastUpdate: null },
    },
    gravity: {
      enabled: true,
      device: 'iSpindel',
      plato: false,
      og: 1.05,
      sg: 1.012,
      // yeast2tap.cpp: last value the device itself reported, before offset and
      // the calibration/temperature correction. The hydrometer page shows both.
      reportedSg: 1.008,
      attenuation: 76,
      abv: 4.9,
      temperature: 19.5,
      angle: 25.4,
      rssi: -62,
      battery: 3.95,
      batteryPercent: 62,
      batteryUnit: 'V',
      lastUpdate: 1790000000,
    },
    system: {
      uptime: 3600,
      lastRestartReason: 'power_on',
      resetCount: 3,
      clock: { synced: true, time: 1790000000, localTime: '2026-11-03 08:12:33', timezoneOffset: 10800 },
      heap: { free: 120000, minFree: 90000, largestBlock: 60000, allocatedBlocks: 500, freeBlocks: 40 },
      storage: { totalBytes: 589824, usedBytes: 120000, freeBytes: 469824 },
      wsClients: 1,
    },
    scale: [],
    settings: {
      tempFormat: 'C',
      tempSetMin: 1,
      tempSetMax: 30,
      pidMax: 10,
      Kp: 5,
      Ki: 0.25,
      Kd: -1.5,
      iMaxErr: 0.5,
      idleRangeH: 1,
      idleRangeL: -1,
      heatTargetH: 0.299,
      heatTargetL: -0.199,
      coolTargetH: 0.199,
      coolTargetL: -0.299,
      maxHeatTimeForEst: 600,
      maxCoolTimeForEst: 1200,
      minCoolTime: 180,
      minCoolIdleTime: 300,
      minHeatTime: 180,
      maxHeatTime: 0,
      minHeatIdleTime: 300,
      deadTime: 600,
      fridgeFastFilt: 1,
      fridgeSlowFilt: 4,
      fridgeSlopeFilt: 3,
      beerFastFilt: 3,
      beerSlowFilt: 4,
      beerSlopeFilt: 4,
      lah: 0,
      hs: 0,
      hystMode: 0,
      staleSensorSec: 20,
      oneWireRetryCount: 2,
    },
  };

  function statusMessage(control) {
    // greeting() in yeast2tap.cpp, with a live-style scale block.
    const live = control || { mode: 'o', beerSetting: 20, fridgeSetting: 20, hystMode: 0 };
    const hundredths = (value) => (value === null ? -20000 : Math.round(value * 100));
    return {
      nn: 'yeast2tap',
      ver: '1.0',
      rssi: -55,
      tm: Math.floor(Date.now() / 1000),
      off: -new Date().getTimezoneOffset() * 60,
      log: '',
      scale: {
        ...scale,
        scales: scale.scales.filter((item) => item.configured),
      },
      md: live.mode,
      bs: hundredths(live.beerSetting),
      fs: hundredths(live.fridgeSetting),
      tu: 'C',
      hm: live.hystMode,
      tg: 0,
      htr: 0,
      bx: hundredths(live.beerSetting),
      fx: hundredths(live.fridgeSetting),
      bt: 2000,
    };
  }

  function controlConstants() {
    // PiLink::sendControlConstants(), plus the camelCase aliases the page reads.
    return {
      tempFormat: 'C',
      tempSettingMin: -5,
      tempSettingMax: 40,
      tempSetMin: -5,
      tempSetMax: 40,
      pidMax: 10,
      Kp: 5,
      Ki: 0.25,
      Kd: 1.5,
      iMaxError: 5,
      idleRangeHigh: 0.25,
      idleRangeLow: -0.25,
      heatingTargetUpper: 0.25,
      heatingTargetLower: -0.25,
      coolingTargetUpper: 0.25,
      coolingTargetLower: -0.25,
      maxHeatTimeForEstimate: 600,
      maxCoolTimeForEstimate: 600,
      minCoolTime: 120,
      // Independent heater pulse PI
      indKp: 20,
      indKi: 8,
      indPulse: 1,
    };
  }

  const setupMessage = {
    v: '4.4.0',
    n: 1,
    c: 'yeast2tap',
    s: 1,
    y: 0,
    b: 'e',
    l: '1',
  };

  return {
    state,
    scale,
    scaleDaily,
    scaleSamples,
    config,
    pressure,
    rh,
    gdc,
    ptc,
    profile,
    loglist,
    getstatus,
    statusMessage,
    controlConstants,
    setupMessage,
  };
}
