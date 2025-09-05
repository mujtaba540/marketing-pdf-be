import express from "express";
import puppeteer from "puppeteer";
import handlebars from "handlebars";
import fs from "fs/promises";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";
import morgan from "morgan";
import bodyParser from "body-parser";

const app = express();
const port = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(morgan("tiny"));
app.use(express.static(path.join(__dirname, "public")));
app.use(cors());
app.use(bodyParser.json());

const templatesCache = {};

async function getCompiledTemplate(filename) {
  if (!templatesCache[filename]) {
    const filePath = path.join(__dirname, "views", filename);
    const content = await fs.readFile(filePath, "utf-8");
    templatesCache[filename] = handlebars.compile(content);
  }
  return templatesCache[filename];
}

app.post("/generate-pdf", async (req, res) => {
  const {
    body: property,
    query: { type },
  } = req;

  try {
    const compiledPages = [];

    // Precompile templates (cached)
    const page1Template = await getCompiledTemplate("page-1.handlebars");
    compiledPages.push(
      `<div class="pdf-page">${page1Template(property)}</div>`
    );

    const page2Filename =
      type === "apartment"
        ? "page-2-apt.handlebars"
        : "page-2-villa.handlebars";
    if (property.pricingDetails === "fifty") {
      // show 50/50 else 70/30 one
      property.showFiftyPlan = true;
    } else if (property.pricingDetails === "seventy") {
      property.showSeventyPlan = true;
    } else if (property.pricingDetails === "both") {
      property.showFiftyPlan = true;
      property.showSeventyPlan = true;
    }
    const page2Template = await getCompiledTemplate(page2Filename);
    compiledPages.push(
      `<div class="pdf-page">${page2Template(property)}</div>`
    );

    if (Array.isArray(property.imgUrl)) {
      const page3Template = await getCompiledTemplate("page-3.handlebars");
      const lastPage = property.imgUrl.pop();

      for (const imgSrc of property.imgUrl) {
        compiledPages.push(
          `<div class="pdf-page">${page3Template({
            imgSrc,
          })}</div>`
        );
      }

      if (lastPage) {
        const page4Template = await getCompiledTemplate("page-4.handlebars");
        const showContact =
          property?.brokderDetails.toLowerCase() === "none".toLowerCase()
            ? false
            : true;
        let contactUrl = "";
        if (showContact) {
          if (
            property?.brokderDetails?.toLowerCase() === "oliver".toLowerCase()
          ) {
            // ----- oliver -----
            contactUrl =
              "https://sha-properties.s3.eu-north-1.amazonaws.com/contact-details/v1/oliver.jpeg";
          } else if (
            property?.brokderDetails?.toLowerCase() === "luna".toLowerCase()
          ) {
            // ----- luna -----
            contactUrl =
              "https://sha-properties.s3.eu-north-1.amazonaws.com/contact-details/v1/luna.jpeg";
          } else {
            // ----- micheal hassan -----
            contactUrl =
              "https://sha-properties.s3.eu-north-1.amazonaws.com/contact-details/v1/micheal.jpg";
          }
        }
        compiledPages.push(
          `<div class="pdf-page">${page4Template({
            imgSrc: lastPage,
            showContact,
            contactUrl,
          })}</div>`
        );
      }
    }

    const fullHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            @page { size: A4; }
            body { margin: 0; padding: 0; font-family: Arial, sans-serif; }
            .pdf-page { page-break-after: always; }
            .pdf-page:last-child { page-break-after: auto; }
          </style>
        </head>
        <body>
          ${compiledPages.join("\n")}
        </body>
      </html>
    `;

    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"], // faster and safer in some environments
    });

    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    await browser.close();

    res.set({
      "Content-Type": "application/force-download",
      "Content-Disposition": `attachment; filename="sales-offer-${property.unit_code}.pdf"`,
      "Content-Length": pdfBuffer.length,
    });

    res.send(pdfBuffer);
  } catch (err) {
    console.error("PDF generation failed:", err);
    res.status(500).json(err);
  }
});

app.get("/", async (req, res) => {
  res.send("Server running");
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
