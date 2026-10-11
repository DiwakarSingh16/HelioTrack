# HelioTrack Solar Control

HelioTrack is a responsive monitoring dashboard for an ESP32-based single-axis solar panel tracker. It displays live tracker position, electrical output, environmental readings, historical performance, and connection health on desktop and mobile devices.

The application can receive telemetry from an ESP32 over Wi-Fi or Bluetooth, read a ThingSpeak channel, or run with the included simulator when hardware is unavailable.

## Features

### Live dashboard

- Semicircular instrumentation gauges inspired by the physical tracker display
- X-axis and Y-axis angle readings
- Panel voltage
- Luminance
- Temperature
- Output power calculation from voltage and current
- Tracking error calculation
- Connection and synchronization status
- Responsive desktop and mobile layouts

### Custom sensor fields

- Add additional gauges without changing the source code
- Configure the display name, telemetry key, unit, color, minimum, and maximum
- Read custom properties from ESP32 JSON or ThingSpeak fields
- Custom fields are persisted in browser `localStorage`
- Individually remove custom fields

### Analytics

- Live power, luminance, temperature, and voltage history
- Multi-sensor comparison chart
- Tracking accuracy
- Energy captured
- Estimated gain compared with a fixed panel
- Hourly yield visualization
- Recent system events
- CSV data export

### Data connections

- Built-in realistic simulator
- ESP32 Wi-Fi JSON endpoint polling
- ESP32 Web Bluetooth GATT notifications
- ThingSpeak channel feed integration
- Configurable polling interval
- Connection settings stored locally in the browser

### Access and interface

- Restricted hosted access and signed-in sessions
- Secure sign-out
- Dark industrial monitoring interface
- Keyboard-accessible controls and semantic labels
- Touch-friendly mobile navigation

## Technology stack

| Area | Technology |
| --- | --- |
| Structure | HTML5 |
| Styling | CSS3 with custom properties, Grid, Flexbox, and responsive media queries |
| Application logic | Vanilla JavaScript (ES2022+) |
| Charts | Custom HTML Canvas rendering |
| Gauges | Inline SVG paths controlled with JavaScript and CSS |
| Wi-Fi data | Browser Fetch API and JSON |
| Bluetooth data | Web Bluetooth API and GATT notifications |
| Cloud telemetry | ThingSpeak REST API |
| Local persistence | Web Storage / `localStorage` |
| Data export | Blob API and generated CSV downloads |
| Hosting | OpenAI Sites on Cloudflare infrastructure |
| Authentication | Hosted access policy and signed-in Site sessions |

The project deliberately has no frontend framework, package manager dependency, or build step. It can be served by any static HTTP server.

## Project structure

```text
.
├── .openai/
│   └── hosting.json     # Hosting project and static directory configuration
├── dist/
│   ├── index.html       # Application markup
│   ├── styles.css       # Layout, component, and responsive styling
│   └── app.js           # Telemetry, charts, connections, and interactions
└── README.md
```

## Start the app manually

The application must be opened through an HTTP server. Opening `index.html` directly with a `file://` URL can prevent Bluetooth, network requests, and other browser APIs from working correctly.

### Option 1: Python

From the project directory, run:

```powershell
python -m http.server 4173 --directory dist
```

Then open:

```text
http://localhost:4173
```

### Option 2: Node.js

If Node.js is installed, run:

```powershell
npx --yes serve dist -l 4173
```

Then open:

```text
http://localhost:4173
```

### Option 3: Visual Studio Code Live Server

1. Open the project folder in Visual Studio Code.
2. Install the **Live Server** extension if it is not already available.
3. Right-click `dist/index.html`.
4. Select **Open with Live Server**.

## Connect an ESP32 over Wi-Fi

The ESP32 should expose an HTTP or HTTPS endpoint that returns JSON. Open **Connections**, choose **ESP32 Wi-Fi**, enter the endpoint, select a polling interval, and connect.

Example endpoint:

```text
http://192.168.4.1/data
```

Expected JSON:

```json
{
  "angle": 124.8,
  "sunAngle": 128.1,
  "voltage": 18.6,
  "current": 0.99,
  "lux": 87200,
  "temperature": 32.4
}
```

The endpoint must include a CORS response header that permits the dashboard origin. A basic development configuration is:

```http
Access-Control-Allow-Origin: *
Content-Type: application/json
```

When the hosted HTTPS dashboard is used, browsers normally block requests to an unsecured `http://` ESP32 endpoint as mixed content. For production use, provide an HTTPS endpoint, use ThingSpeak, or run the dashboard locally on the same network.

## Connect using Bluetooth

1. Configure the ESP32 as a Bluetooth Low Energy peripheral.
2. Create a telemetry service and readable/notifiable characteristic.
3. Open **Connections** and select **Bluetooth**.
4. Enter the service and characteristic UUIDs.
5. Select **Pair Bluetooth device**.

The characteristic can send either the JSON structure shown above or comma-separated values in this order:

```text
angle,sunAngle,voltage,current,lux,temperature
```

Example:

```text
124.8,128.1,18.6,0.99,87200,32.4
```

Web Bluetooth works best in Chrome or Edge on desktop and Android. It is not broadly supported by iOS Safari.

## Connect to ThingSpeak

1. Open **Connections** and select **ThingSpeak**.
2. Enter the channel ID.
3. Enter the read API key when the channel is private.
4. Choose a refresh interval of at least 15 seconds.

Default field mapping:

| ThingSpeak field | Dashboard value |
| --- | --- |
| `field1` | Panel angle |
| `field2` | Sun angle |
| `field3` | Voltage |
| `field4` | Current |
| `field5` | Luminance |
| `field6` | Temperature |

Additional ThingSpeak values can be displayed with **Add field**, using keys such as `field7` or `field8`.

## Custom fields

Select **Add field** on the Overview screen and provide:

- **Display name:** Text shown above the gauge
- **Data key:** Property in the incoming payload, such as `humidity`, `current`, or `field7`
- **Unit:** Gauge suffix, such as `A`, `%`, `rpm`, or `°C`
- **Gauge color:** Instrument color
- **Minimum and maximum:** Expected sensor range

Custom field definitions are stored only in the current browser. Clearing browser site data removes them.

## Validate changes

Check JavaScript syntax:

```powershell
node --check dist/app.js
```

Start the local server and test these areas after making changes:

- Overview gauges update continuously
- Analytics navigation and charts render correctly
- Custom fields can be added and removed
- Wi-Fi and ThingSpeak failures show a useful status message
- Bluetooth pairing opens only after a user action
- Layout remains usable on phone-sized screens
- CSV export downloads valid data

## Browser support

Current versions of Chrome and Edge provide the broadest feature support. Firefox and Safari can run the dashboard and Wi-Fi/ThingSpeak integrations, but Web Bluetooth support varies.

## Security notes

- Connection configuration and custom fields are stored in the browser, not transmitted to an application database.
- ThingSpeak read keys are stored in browser `localStorage`; use a read-only key.
- Never place a ThingSpeak write key, Wi-Fi password, or private device credential in the source files.
- Hosted access restrictions are managed separately from ESP32 and ThingSpeak credentials.
- Use HTTPS for production endpoints whenever possible.

## Hosted version

The deployed application is available at:

[https://heliotrack-solar-control.ds6918821.chatgpt.site](https://heliotrack-solar-control.ds6918821.chatgpt.site)

