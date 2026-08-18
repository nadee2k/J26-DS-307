export type EnvironmentReading = {
  temperature?: number
  humidity?: number
  light?: number
  noise?: number
  motion?: boolean
  accX?: number
  accY?: number
  accZ?: number
  gyroX?: number
  gyroY?: number
  gyroZ?: number
  distance?: number
  radarState?: string
}

const NUMBER_SOURCE = String.raw`-?\d+(?:\.\d+)?(?:e[+-]?\d+)?`

function firstNumber(line: string): string | null {
  const match = line.match(new RegExp(NUMBER_SOURCE, "i"))
  return match ? match[0] : null
}

function allNumbers(line: string): number[] {
  return [...line.matchAll(new RegExp(NUMBER_SOURCE, "gi"))].map((match) => Number(match[0]))
}

function axisValue(line: string, names: string[]): number | undefined {
  for (const name of names) {
    const match = line.match(new RegExp(`${name}\\s*[:=]?\\s*(${NUMBER_SOURCE})`, "i"))
    if (match) return Number(match[1])
  }
  return undefined
}

function assignXyz(
  reading: EnvironmentReading,
  line: string,
  keys: ["accX", "accY", "accZ"] | ["gyroX", "gyroY", "gyroZ"],
) {
  const labeled =
    keys[0] === "gyroX"
      ? {
          x: axisValue(line, ["gx", "gyro[_\\s-]*x", "x"]),
          y: axisValue(line, ["gy", "gyro[_\\s-]*y", "y"]),
          z: axisValue(line, ["gz", "gyro[_\\s-]*z", "z"]),
        }
      : {
          x: axisValue(line, ["ax", "acc[_\\s-]*x", "x"]),
          y: axisValue(line, ["ay", "acc[_\\s-]*y", "y"]),
          z: axisValue(line, ["az", "acc[_\\s-]*z", "z"]),
        }

  if (labeled.x !== undefined && labeled.y !== undefined && labeled.z !== undefined) {
    reading[keys[0]] = labeled.x
    reading[keys[1]] = labeled.y
    reading[keys[2]] = labeled.z
    return
  }

  const values = allNumbers(line)
  if (values.length < 3) {
    if (keys[0] === "gyroX") {
      if (labeled.x !== undefined) reading.gyroX = labeled.x
      if (labeled.y !== undefined) reading.gyroY = labeled.y
      if (labeled.z !== undefined) reading.gyroZ = labeled.z
    } else {
      if (labeled.x !== undefined) reading.accX = labeled.x
      if (labeled.y !== undefined) reading.accY = labeled.y
      if (labeled.z !== undefined) reading.accZ = labeled.z
    }
    return
  }
  const last = values.slice(-3)
  reading[keys[0]] = last[0]
  reading[keys[1]] = last[1]
  reading[keys[2]] = last[2]
}

export function parseLabeledLine(line: string, reading: EnvironmentReading): void {
  const text = line.toLowerCase()
  const raw = firstNumber(line)

  if (/\b(gx|gy|gz)\b/.test(text) || text.includes("gyro")) {
    assignXyz(reading, line, ["gyroX", "gyroY", "gyroZ"])
    return
  }
  if (/\b(ax|ay|az)\b/.test(text) || (text.includes("acc") && !text.includes("accuracy"))) {
    assignXyz(reading, line, ["accX", "accY", "accZ"])
    return
  }
  if (text.includes("distance") && raw !== null) {
    reading.distance = Number(raw)
    return
  }
  if (text.includes("radar")) {
    const value = line.split(":").pop()?.trim()
    if (value) reading.radarState = value
    return
  }
  if (text.includes("temperature") && raw !== null) {
    reading.temperature = Number(raw)
  } else if (text.includes("humidity") && raw !== null) {
    reading.humidity = Number(raw)
  } else if (text.includes("light") && raw !== null) {
    reading.light = Math.round(Number(raw))
  } else if (text.includes("noise") && raw !== null) {
    reading.noise = Math.round(Number(raw))
  } else if ((text.includes("pir") || text.includes("motion")) && !text.includes("radar")) {
    if (text.includes("detect") || text.includes("yes") || text.includes("true")) {
      reading.motion = true
    } else if (text.includes("no") || text.includes("clear") || text.includes("idle")) {
      reading.motion = false
    } else if (raw !== null) {
      reading.motion = Boolean(Number(raw))
    }
  }
}

export function parseCsvLine(line: string): EnvironmentReading | null {
  const parts = line.split(",").map((part) => part.trim())
  if (parts.length !== 5 && parts.length !== 11) return null
  const values = parts.map(Number)
  if (values.some((value) => Number.isNaN(value))) return null
  const reading: EnvironmentReading = {
    temperature: values[0],
    humidity: values[1],
    light: Math.round(values[2]),
    noise: Math.round(values[3]),
    motion: Boolean(values[4]),
  }
  if (parts.length === 11) {
    reading.accX = values[5]
    reading.accY = values[6]
    reading.accZ = values[7]
    reading.gyroX = values[8]
    reading.gyroY = values[9]
    reading.gyroZ = values[10]
  }
  return reading
}

export function isComplete(reading: EnvironmentReading): boolean {
  return (
    reading.temperature !== undefined ||
    reading.humidity !== undefined ||
    reading.light !== undefined ||
    reading.gyroX !== undefined ||
    reading.accX !== undefined
  )
}

export function isSeparator(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.length > 0 && /^[=-]+$/.test(trimmed)
}
