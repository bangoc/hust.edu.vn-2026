const submittedContentValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["_id", "url", "format", "title", "content", "outLinks", "createdAt", "updatedAt"],
    properties: {
      _id: {bsonType: "string", description: "Exact trimmed source URL; unique primary key"},
      url: {bsonType: "string", pattern: "^[hH][tT][tT][pP][sS]?://", minLength: 1},
      format: {bsonType: "string", pattern: "^[a-z0-9][a-z0-9.+_-]{0,31}$"},
      title: {bsonType: "string", minLength: 1},
      content: {bsonType: "string", description: "Extracted text; may be empty for images"},
      intro: {bsonType: "string", description: "Optional introductory text"},
      base64: {
        bsonType: "string", minLength: 1,
        description: "Optional raw standard Base64 image data; absent for text-only documents",
        pattern: "^[A-Za-z0-9+/]+={0,2}$"
      },
      outLinks: {
        bsonType: "array",
        items: {
          bsonType: "object", required: ["url", "text"],
          properties: {
            url: {bsonType: "string", pattern: "^[hH][tT][tT][pP][sS]?://"},
            text: {bsonType: "string"}
          }
        }
      },
      createdAt: {bsonType: "date"},
      updatedAt: {bsonType: "date"}
    }
  }
};
if (db.getCollectionNames().includes("submitted_contents")) {
  assert.commandWorked(db.runCommand({collMod: "submitted_contents",
    validator: submittedContentValidator, validationLevel: "strict", validationAction: "error"}));
} else {
  db.createCollection("submitted_contents", {validator: submittedContentValidator,
    validationLevel: "strict", validationAction: "error"});
}
