export default function jsonParser(text: string): string | null {
  // EXPECTED PARAMS is string that start with ```json and end with ```
  // const start = text.indexOf("```json");
  // const end = text.indexOf("```", start + 1);
  //
  // if (start === -1 || end === -1) {
  //   console.error("Failed to find the json snippet");
  //   return null;
  // }
  //
  // const jsonString = text.slice(start + 7, end).trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed while parsing the text to json", e);
    return null;
  }
}
