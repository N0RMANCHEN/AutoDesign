#!/usr/bin/env swift

import Foundation
import Vision

struct OCRLine: Codable {
    let text: String
    let confidence: Double
    let bounds: Bounds
}

struct Bounds: Codable {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

if CommandLine.arguments.count < 2 {
    fputs("usage: ocr_preview_vision.swift <image-path>\n", stderr)
    exit(1)
}

let imagePath = CommandLine.arguments[1]
let imageURL = URL(fileURLWithPath: imagePath)

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["en-US"]
request.minimumTextHeight = 0.008

do {
    let handler = VNImageRequestHandler(url: imageURL, options: [:])
    try handler.perform([request])

    let observations = request.results ?? []
    let lines = observations.compactMap { observation -> OCRLine? in
        guard let candidate = observation.topCandidates(1).first else {
            return nil
        }
        let box = observation.boundingBox
        return OCRLine(
            text: candidate.string,
            confidence: Double(candidate.confidence),
            bounds: Bounds(
                x: Double(box.origin.x),
                y: Double(1.0 - box.origin.y - box.size.height),
                width: Double(box.size.width),
                height: Double(box.size.height)
            )
        )
    }.sorted {
        if abs($0.bounds.y - $1.bounds.y) > 0.01 {
            return $0.bounds.y < $1.bounds.y
        }
        return $0.bounds.x < $1.bounds.x
    }

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    let data = try encoder.encode(lines)
    FileHandle.standardOutput.write(data)
} catch {
    fputs("vision ocr failed: \(error)\n", stderr)
    exit(1)
}
