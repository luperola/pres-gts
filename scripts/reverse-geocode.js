import xlsx from "xlsx";

const [, , inputPath, coordinateColumn, outputPathArg] = process.argv;

if (!inputPath || !coordinateColumn) {
  console.error(
    "Usage: node scripts/reverse-geocode.js <input.xlsx> <coordinate-column> [output.xlsx]"
  );
  process.exit(1);
}

function parseCoordinate(value) {
  if (!value) return null;
  const match = String(value).match(
    /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/
  );
  if (!match) return null;
  return { lat: Number(match[1]), lon: Number(match[2]) };
}

async function reverseGeocode({ lat, lon }) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("zoom", "18");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "pres-gts-geocoder/1.0 (https://openai.com)",
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim request failed with status ${response.status}`);
  }

  const data = await response.json();
  const address = data.address ?? {};

  return {
    displayName: data.display_name ?? "",
    road: address.road ?? address.pedestrian ?? address.cycleway ?? "",
    neighbourhood:
      address.neighbourhood ?? address.suburb ?? address.quarter ?? "",
    city:
      address.city ??
      address.town ??
      address.village ??
      address.municipality ??
      "",
    state: address.state ?? "",
    postcode: address.postcode ?? "",
    country: address.country ?? "",
  };
}

async function main() {
  const workbook = xlsx.readFile(inputPath, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });

  const enrichedRows = [];

  for (const row of rows) {
    const coordinateValue = row[coordinateColumn];
    const coords = parseCoordinate(coordinateValue);

    if (!coords) {
      enrichedRows.push({ ...row, geocode_status: "coordinate_not_found" });
      continue;
    }

    try {
      const geo = await reverseGeocode(coords);
      enrichedRows.push({
        ...row,
        geocode_status: "ok",
        geocode_display_name: geo.displayName,
        geocode_road: geo.road,
        geocode_neighbourhood: geo.neighbourhood,
        geocode_city: geo.city,
        geocode_state: geo.state,
        geocode_postcode: geo.postcode,
        geocode_country: geo.country,
      });
    } catch (error) {
      enrichedRows.push({ ...row, geocode_status: `error: ${error.message}` });
    }

    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  const worksheet = xlsx.utils.json_to_sheet(enrichedRows);
  const outputWorkbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(outputWorkbook, worksheet, sheetName);

  const outputPath =
    outputPathArg ?? inputPath.replace(/\.xlsx$/i, "") + "-geocoded.xlsx";
  xlsx.writeFile(outputWorkbook, outputPath);

  console.log(`Geocoded data saved to ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
