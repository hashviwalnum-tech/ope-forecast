# Translation Review — Domain-Critical Terms

Machine translations in this app cover 15 languages. The strings below are **trust-critical**:
ordering decisions and money terms that wrong-translate could cause a business owner to order
the wrong quantity or misread their forecasts. Please have each language reviewed by a native
speaker familiar with **retail/inventory/small-business** vocabulary.

The surrounding context for every term: a small-business inventory and demand-forecasting app
(café, salon, florist, etc.) that tells owners when and how much to order.

---

## 1 — Reorder / inventory trigger terms

These phrases tell an owner when to place a new order. Getting the verb ("order", "restock",
"replenish") and the threshold concept ("drop below", "fall under") right is critical.

| Key | English original | zh | es | hi | ar | pt | ru | fr | bn | ur | id | de | ja | tr |
|-----|-----------------|----|----|----|----|----|----|----|----|----|----|----|----|-----|
| `reorderWhenBelow` | "Order more when you drop below" | 当库存低于以下时补货 | Pide más cuando bajes de | जब इससे कम हो जाए तो और ऑर्डर करें | اطلب المزيد عند انخفاض المخزون عن | Peça mais quando baixar de | Заказывайте ещё, когда запас опустится ниже | Commandez plus quand vous descendez en dessous de | যখন এর নিচে নামে তখন আরো অর্ডার করুন | جب اس سے کم ہو تو مزید آرڈر کریں | Pesan lebih saat turun di bawah | Mehr bestellen, wenn Sie unter … fallen | 在庫が以下を下回ったら追加で注文 | Şu miktarın altına düştüğünde daha fazla sipariş verin |
| `safetyBufferLabel` | "Keep at least … as backup" | 至少保留…作为缓冲 | Mantén al menos … de reserva | कम से कम … बफर के रूप में रखें | احتفظ بما لا يقل عن … كاحتياط | Mantenha pelo menos … como reserva | Держите не менее … в запасе | Gardez au moins … en réserve | কমপক্ষে … মজুদ রাখুন | کم از کم … بفر کے طور پر رکھیں | Simpan minimal … sebagai cadangan | Behalten Sie mindestens … als Puffer | 少なくとも…を予備として保持 | En az … tampon olarak tutun |
| `reorderPoint` (concept) | "Reorder point" | 补货点 | Punto de reorden | पुनर्ऑर्डर बिंदु | نقطة إعادة الطلب | Ponto de reabastecimento | Точка перезаказа | Point de réapprovisionnement | পুনরায় অর্ডার পয়েন্ট | دوبارہ آرڈر کا نقطہ | Titik pemesanan ulang | Nachbestellpunkt | 再注文ポイント | Yeniden sipariş noktası |
| `safetyStock` (concept) | "Safety stock" / "Safety buffer" | 安全库存 / 安全缓冲 | Stock de seguridad | सुरक्षा स्टॉक | مخزون الأمان | Estoque de segurança | Страховой запас | Stock de sécurité | নিরাপত্তা মজুদ | حفاظتی ذخیرہ | Stok pengaman | Sicherheitsbestand | 安全在庫 | Güvenlik stoğu |
| `suggestedOrder` | "Suggested order" | 建议订量 | Cantidad sugerida | सुझाई गई ऑर्डर मात्रा | الكمية المقترحة | Quantidade sugerida | Рекомендуемый заказ | Commande suggérée | প্রস্তাবিত অর্ডার | تجویز کردہ آرڈر | Jumlah pesanan yang disarankan | Empfohlene Bestellmenge | 推奨注文数量 | Önerilen sipariş |
| `idealOrderEOQ` | "Best order size" (EOQ) | 最佳订购量 | Tamaño óptimo de pedido | सर्वोत्तम ऑर्डर आकार | الكمية المثلى للطلب | Quantidade ideal de pedido | Оптимальный размер заказа | Quantité de commande optimale | সর্বোত্তম অর্ডার আকার | بہترین آرڈر سائز | Ukuran pesanan optimal | Optimale Bestellmenge | 最適注文量 | Optimal sipariş miktarı |
| `coversLeadTimeSafety` | "covers delivery time + backup" | 覆盖交货时间 + 缓冲 | cubre el tiempo de entrega + reserva | डिलीवरी समय + बफर कवर करता है | يغطي وقت التسليم + الاحتياط | cobre o prazo de entrega + reserva | покрывает время доставки + запас | couvre le délai de livraison + réserve | ডেলিভারি সময় + বাফার কভার করে | ڈیلیوری وقت + بفر کور کرتا ہے | mencakup waktu pengiriman + cadangan | deckt Lieferzeit + Puffer | 納期 + バッファーをカバー | teslim süresini + tamponu karşılar |

---

## 2 — Forecast / accuracy terms

These explain how the forecast is built and how accurate it is. Owners trust these numbers to
order stock and schedule staff.

| Key | English original | zh | es | hi | ar | pt | ru | fr | bn | ur | id | de | ja | tr |
|-----|-----------------|----|----|----|----|----|----|----|----|----|----|----|----|-----|
| `demandForecast` | "Demand forecast" | 需求预测 | Pronóstico de demanda | मांग पूर्वानुमान | توقع الطلب | Previsão de demanda | Прогноз спроса | Prévision de la demande | চাহিদা পূর্বাভাস | طلب کی پیش گوئی | Perkiraan permintaan | Bedarfsprognose | 需要予測 | Talep tahmini |
| `averageError` | "Average error" (MAPE context) | 平均误差 | Error promedio | औसत त्रुटि | متوسط الخطأ | Erro médio | Средняя ошибка | Erreur moyenne | গড় ত্রুটি | اوسط غلطی | Rata-rata kesalahan | Durchschnittlicher Fehler | 平均誤差 | Ortalama hata |
| `driftCheck` | "Drift check" (tracking signal) | 偏移检查 | Verificación de deriva | ड्रिफ्ट जांच | فحص الانجراف | Verificação de deriva | Проверка дрейфа | Vérification de dérive | ড্রিফ্ট পরীক্ষা | بہاؤ کی جانچ | Pemeriksaan penyimpangan | Drift-Überprüfung | ドリフトチェック | Sürüklenme kontrolü |
| `likelyRange` | "Likely range" (prediction interval) | 可能范围 | Rango probable | संभावित सीमा | النطاق المرجح | Faixa provável | Вероятный диапазон | Plage probable | সম্ভাব্য পরিসর | ممکنہ حد | Rentang yang mungkin | Wahrscheinlicher Bereich | 予測範囲 | Olası aralık |
| `projectedStockLabel` | "Projected stock now" | 预计当前库存 | Stock proyectado ahora | अनुमानित मौजूदा स्टॉक | المخزون المتوقع الآن | Estoque projetado agora | Прогнозируемый запас | Stock projeté maintenant | প্রক্ষেপিত বর্তমান মজুদ | متوقع موجودہ ذخیرہ | Stok proyeksi sekarang | Prognostizierter Bestand | 現在の予測在庫 | Tahmini mevcut stok |
| `modelNameWma` | "Weighted moving average" | 加权移动平均 | Promedio móvil ponderado | भारित चलती औसत | المتوسط المتحرك الموزون | Média móvel ponderada | Взвешенное скользящее среднее | Moyenne mobile pondérée | ভারযুক্ত চলমান গড় | وزنی متحرک اوسط | Rata-rata bergerak tertimbang | Gewichteter gleitender Durchschnitt | 加重移動平均 | Ağırlıklı hareketli ortalama |
| `modelNameExpSmooth` | "Exponential smoothing" | 指数平滑 | Suavización exponencial | घातांकीय स्मूदिंग | التمهيد الأسي | Suavização exponencial | Экспоненциальное сглаживание | Lissage exponentiel | এক্সপোনেনশিয়াল স্মুদিং | ایکسپوننشل ہموار کاری | Pemulusan eksponensial | Exponentielle Glättung | 指数平滑法 | Üstel yumuşatma |
| `modelNameSeasonal` | "Seasonal (day-of-week)" | 季节性 | Estacional | मौसमी | موسمي | Sazonal | Сезонный | Saisonnier | মৌসুমী | موسمی | Musiman | Saisonal | 季節性 | Mevsimsel |

---

## 3 — FIFO / batch / shelf-life terms

These describe stock management. If misunderstood, an owner might sell new stock before old,
causing spoilage.

| Key | English original | zh | es | hi | ar | pt | ru | fr | bn | ur | id | de | ja | tr |
|-----|-----------------|----|----|----|----|----|----|----|----|----|----|----|----|-----|
| `fifoAssumptionNote` | "Assumes oldest stock sold first (FIFO)" | 假设最旧的库存先售出（先进先出） | Se asume que el stock más antiguo se vende primero (FIFO) | मान लिया जाता है कि सबसे पुराना स्टॉक पहले बिकता है (FIFO) | يُفترض أن المخزون الأقدم يُباع أولاً (FIFO) | Assume que o estoque mais antigo é vendido primeiro (PEPS) | Предполагается, что старый запас продаётся первым (ФИФО) | Hypothèse : le stock le plus ancien est vendu en premier (FIFO) | ধরে নেওয়া হয় সবচেয়ে পুরনো মজুদ প্রথমে বিক্রি হয় | فرض کیا جاتا ہے کہ پرانا ذخیرہ پہلے فروخت ہوتا ہے | Diasumsikan stok terlama dijual lebih dulu (FIFO) | Es wird angenommen, dass der älteste Bestand zuerst verkauft wird (FIFO) | 最も古い在庫が最初に売れると仮定（FIFO） | En eski stokun önce satıldığı varsayılır (FIFO) |
| `shelfLifeLabel` | "Shelf life (days before spoiling)" | 保质期（变质前天数） | Vida útil (días antes de caducar) | शेल्फ लाइफ (खराब होने से पहले दिन) | مدة الصلاحية (أيام قبل الفساد) | Prazo de validade (dias antes de estragar) | Срок хранения (дней до порчи) | Durée de conservation (jours avant péremption) | শেলফ লাইফ (নষ্ট হওয়ার আগে দিন) | شیلف لائف (خراب ہونے سے پہلے دن) | Umur simpan (hari sebelum rusak) | Haltbarkeit (Tage bis zum Verderb) | 賞味期限（腐敗までの日数） | Raf ömrü (bozulmadan önce gün) |
| `spoilageAlert` | "Spoilage alert" | 损耗提醒 | Alerta de caducidad | खराब होने की चेतावनी | تنبيه الفساد | Alerta de vencimento | Предупреждение о порче | Alerte de péremption | নষ্ট হওয়ার সতর্কতা | خراب ہونے کی چتاونی | Peringatan kerusakan | Verfallswarnung | 傷み警告 | Bozulma uyarısı |

---

## 4 — CLV / regulars financial terms

These appear in the "Regulars" section and represent financial projections for loyal customers.

| Key | English original | zh | es | hi | ar | pt | ru | fr | bn | ur | id | de | ja | tr |
|-----|-----------------|----|----|----|----|----|----|----|----|----|----|----|----|-----|
| `clvLabel` | "Customer value: $X" (CLV) | 客户价值 | Valor del cliente | ग्राहक मूल्य | قيمة العميل | Valor do cliente | Ценность клиента | Valeur client | গ্রাহকের মূল্য | گاہک کی قدر | Nilai pelanggan | Kundenwert | 顧客価値 | Müşteri değeri |
| `clvEstimateText` | "Estimated customer value over N years" | X年预计客户价值 | Valor estimado del cliente en N años | N वर्षों में अनुमानित ग्राहक मूल्य | القيمة التقديرية للعميل على مدى N سنوات | Valor estimado do cliente em N anos | Расчётная ценность клиента за N лет | Valeur client estimée sur N ans | N বছরে আনুমানিক গ্রাহক মূল্য | N سالوں میں متوقع گاہک قدر | Perkiraan nilai pelanggan selama N tahun | Geschätzter Kundenwert über N Jahre | N年間の推定顧客価値 | N yıl boyunca tahmini müşteri değeri |

---

## 5 — Revenue / profitability labels

| Key | English original | zh | es | hi | ar | pt | ru | fr | bn | ur | id | de | ja | tr |
|-----|-----------------|----|----|----|----|----|----|----|----|----|----|----|----|-----|
| `profitabilityTitle` | "Revenue from {name}" | {name}的收入 | Ingresos de {name} | {name} से राजस्व | الإيرادات من {name} | Receita de {name} | Доход от {name} | Revenus de {name} | {name} থেকে আয় | {name} سے آمدنی | Pendapatan dari {name} | Einnahmen von {name} | {name}の収益 | {name}'dan gelir |
| `toolboxTotalProfit` | "Expected profit" | 预期利润 | Beneficio esperado | अपेक्षित लाभ | الربح المتوقع | Lucro esperado | Ожидаемая прибыль | Bénéfice attendu | প্রত্যাশিত মুনাফা | متوقع منافع | Keuntungan yang diharapkan | Erwarteter Gewinn | 予想利益 | Beklenen kâr |
| `periodExtraPerUnit` | "Extra customers per unit spent" | 每单位支出的额外客户 | Clientes adicionales por unidad gastada | प्रति इकाई खर्च पर अतिरिक्त ग्राहक | عملاء إضافيون لكل وحدة منفقة | Clientes extras por unidade gasta | Дополнительных клиентов на единицу расхода | Clients supplémentaires par unité dépensée | প্রতি ব্যয় এককে অতিরিক্ত গ্রাহক | فی اکائی خرچ اضافی گاہک | Pelanggan ekstra per unit yang dihabiskan | Zusätzliche Kunden pro ausgegebener Einheit | 費やした単位あたりの追加顧客 | Harcanan birim başına ekstra müşteri |

---

## Notes for reviewers

- **Arabic (ar) and Urdu (ur)** are rendered right-to-left — the text direction is handled by the UI, not the translations themselves. Review the word choice, not the layout.
- **Bengali (bn)** and **Hindi (hi)** use Devanagari/Bengali script; please verify the script is correct, not just the meaning.
- **Japanese (ja)** uses no spaces between words — verify compound terms like 再注文ポイント are the industry-standard terms.
- **Indonesian (id)** business/retail vocabulary sometimes differs from formal dictionary translations — verify with someone who works in a retail/F&B context.
- Strings containing `{placeholders}` like `{n}`, `{name}`, `{qty}` must keep those tokens exactly as-is; only the surrounding text is translated.
- All these translations are currently machine-generated (first pass). The non-flagged strings (navigation labels, button text, error messages) are lower-risk and reviewed separately.
