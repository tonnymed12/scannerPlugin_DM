sap.ui.define([
    'jquery.sap.global',
    "sap/dm/dme/podfoundation/controller/PluginViewController",
    "sap/ui/model/json/JSONModel",
    "./Utils/Commons",
    "./Utils/ApiPaths",
    "../model/formatter",
    "sap/ui/core/Element",
    "sap/m/MessageBox",
    "sap/m/Dialog",
    "sap/m/Input",
    "sap/m/Button",
    "sap/ui/core/library"
], function (jQuery, PluginViewController, JSONModel, Commons, ApiPaths, formatter, Element, MessageBox, Dialog, Input, Button, CoreLibrary) {
    "use strict";

    var gOperationPhase = {};
    const OPERATION_STATUS = { ACTIVE: "ACTIVE", QUEUED: "IN_QUEUE" }

    return PluginViewController.extend("serviacero.custom.plugins.zpluginPutBatchWCPintado.zpluginPutBatchWCPintado.controller.MainView", {
        Commons: Commons,
        ApiPaths: ApiPaths,
        formatter: formatter,
        onInit: function () {
            PluginViewController.prototype.onInit.apply(this, arguments);
            this.oScanInput = this.byId("scanInput");

        },

        onAfterRendering: function () {
            this.onGetCustomValues();
            this.onGetOrderCustomValues();
        },
        _getCurrentOperationStatus: function () {
            var oPodSelectionModel = this.getPodSelectionModel();
            var sCurrentStatus = "";

            if (oPodSelectionModel && oPodSelectionModel.selectedPhaseData) {
                sCurrentStatus = oPodSelectionModel.selectedPhaseData.status || "";
            }

            if (!sCurrentStatus && gOperationPhase) {
                sCurrentStatus = gOperationPhase.status || "";
            }

            return sCurrentStatus;
        },
        onGetCustomValues: function () {
            const oView = this.getView(),
                oSapApi = this.getPublicApiRestDataSourceUri(),
                url = oSapApi + this.ApiPaths.WORKCENTERS,
                oTable = oView.byId("idSlotTable"),
                oPODParams = this.Commons.getPODParams(this.getOwnerComponent()),

                oParams = {
                    plant: oPODParams.PLANT_ID,
                    workCenter: oPODParams.WORK_CENTER
                };


            this.ajaxGetRequest(url, oParams, function (oRes) {
                // Tomamos el primer objeto del array
                const oData = Array.isArray(oRes) ? oRes[0] : oRes;

                if (!oData || !oData.customValues) {
                    console.error("No se encontraron customValues en la respuesta");
                    return;
                }

                const aCustomValues = oData.customValues;

                const cantidadSlot = aCustomValues.find((element) => element.attribute === "SLOTQTY") || { value: "0" };
                const tipoSlot = aCustomValues.find((element) => element.attribute === "SLOTTIPO") || { value: "" };
                const noCargaSlot = aCustomValues.find((element) => element.attribute === "NO_CARGA") || { value: "0" };
                const aSlots = aCustomValues.filter(item =>
                    item.attribute.startsWith("SLOT") &&
                    item.attribute !== "SLOTQTY" &&
                    item.attribute !== "SLOTTIPO"
                );

                //  Rellenar slots faltantes según SLOTQTY
                const iSlotQty = parseInt(cantidadSlot.value || "0", 10);
                let aSlotsFixed = [...aSlots];

                // Caso 1 :hay más slots con valor que los permitidos -> eliminar y actualizar en vacio
                if (aSlotsFixed.length > iSlotQty) {
                    // Nos quedamos solo con los primeros 
                    aSlotsFixed = aSlotsFixed.slice(0, iSlotQty);

                    // Los que se eliminaron, hay que vaciarlos en el update
                    const aSobran = aSlots.slice(iSlotQty);
                    aSobran.forEach(slot => {
                        slot.value = "";  // se vacían para mandar update
                    });

                    // Mandar update inmediato para limpiar los sobrantes
                    const oParamsUpdate = {
                        inCustomValues: aCustomValues.map(item => {
                            // si está en los que sobran, value vacío
                            const sobrante = aSobran.find(s => s.attribute === item.attribute);
                            return sobrante ? { attribute: item.attribute, value: "" } : item;
                        }),
                        inPlant: oPODParams.PLANT_ID,
                        inWorkCenter: oPODParams.WORK_CENTER
                    };

                    this.setCustomValuesPp(oParamsUpdate, oSapApi).then(() => {
                        console.log("Lotes sobrantes eliminados correctamente");
                    });
                }
                // Caso 2: hay menos slots que SLOTQTY -> rellenar vacíos
                for (let i = aSlotsFixed.length + 1; i <= iSlotQty; i++) {
                    aSlotsFixed.push({
                        attribute: "SLOT" + i.toString().padStart(3, "0"),
                        value: "" // valor vacío para que después lo puedan llenar
                    });
                }

                // Setear los datos en la tabla
                oTable.setModel(new sap.ui.model.json.JSONModel({ ITEMS: aSlotsFixed }));

                // Setear los valores en los inputs
                oView.byId("noCarga").setValue(noCargaSlot.value || "0");
                oView.byId("slotQty").setValue(cantidadSlot.value || "0");
                oView.byId("slotType").setValue(tipoSlot.value || "");

                // Actualizar indicador de progreso
                this._updateProgressIndicator();

            }.bind(this));
        },
        /**
        * Funcion del boton "inicioCarga" - Abre diálogo para ingresar cantidad de lotes para la nueva carga
        * @returns {void}
        */
        onInicioEscaneo: function () {
            const oView = this.getView(),
                oBundle = oView.getModel("i18n").getResourceBundle();

            // Validar que la carga actual esté completa antes de iniciar una nueva
            const oTable = oView.byId("idSlotTable");
            const oModel = oTable.getModel();
            const aItems = oModel ? oModel.getProperty("/ITEMS") : [];
            const iSlotQty = parseInt(oView.byId("slotQty").getValue() || "0", 10);

            const sCurrentStatus = this._getCurrentOperationStatus();
            if (sCurrentStatus !== OPERATION_STATUS.ACTIVE) {
                sap.m.MessageBox.error(oBundle.getText("verificarStatusOperacion"))
                return;
            }

            // Contar slots con valor (escaneados)
            const iEscaneados = aItems.filter(slot => slot.value && slot.value.trim() !== "").length;


            // Validar que estén completos (solo si SLOTQTY > 0, es decir, hay una carga activa)
            if (iSlotQty > 0 && iEscaneados < iSlotQty) {
                const iFaltantes = iSlotQty - iEscaneados;
                sap.m.MessageBox.warning(
                    oBundle.getText("cargaIncompleta", [iEscaneados, iSlotQty, iFaltantes]) ||
                    `La carga actual no está completa.\nEscaneados: ${iEscaneados}/${iSlotQty}\nFaltan ${iFaltantes} lote(s) por escanear.`,
                    {
                        title: oBundle.getText("cargaIncompletaTitle") || "Carga Incompleta"
                    }
                );
                return;
            }

            // Crear input para la cantidad
            const oQuantityInput = new Input({
                type: "Number",
                placeholder: oBundle.getText("cantidadPlaceholder") || "Ej: 35",
                liveChange: function (oEvent) {
                    const iValue = parseInt(oEvent.getSource().getValue(), 10);
                    oOkButton.setEnabled(iValue > 0);
                }
            });

            // boton confirmacion OK 
            const oOkButton = new Button({
                text: oBundle.getText("okButton") || "OK",
                enabled: false,
                press: function () {
                    const iCantidad = parseInt(oQuantityInput.getValue(), 10);
                    if (iCantidad > 0) {
                        oDialog.close();
                        this._iniciarNuevaCarga(iCantidad);
                    } else {
                        sap.m.MessageToast.show(oBundle.getText("cantidadInvalida") || "Ingrese una cantidad válida");
                    }
                }.bind(this)
            });

            // Botón Cancel
            const oCancelButton = new Button({
                text: oBundle.getText("cancelButton") || "Cancelar",
                type: "Reject",
                press: function () {
                    oDialog.close();
                }
            });

            // Crear diálogo
            const oDialog = new Dialog({
                title: oBundle.getText("iniciarCargaDialogTitle") || "Iniciar Nueva Carga",
                content: [
                    oQuantityInput
                ],
                buttons: [oOkButton, oCancelButton],
                afterClose: function () {
                    oDialog.destroy();
                }
            });

            oDialog.open();
            oQuantityInput.focus();
        },
        /**
        * Finalizar carga: ajustar SLOTQTY al número real escaneado
        * @returns {void}
        */
        onFinalizarCarga: function () {
            const oView = this.getView(),
                oBundle = oView.getModel("i18n").getResourceBundle(),
                oPODParams = this.Commons.getPODParams(this.getOwnerComponent()),
                oSapApi = this.getPublicApiRestDataSourceUri();

            const oTable = oView.byId("idSlotTable");
            const oModel = oTable.getModel();
            const aItems = oModel ? oModel.getProperty("/ITEMS") : [];
            const iSlotQty = parseInt(oView.byId("slotQty").getValue() || "0", 10);
            const iEscaneados = aItems.filter(slot => slot.value && slot.value.trim() !== "").length;
            const sNoCarga = oView.byId("noCarga").getValue() || "0";

            if (iSlotQty <= 0) {
                sap.m.MessageToast.show(oBundle.getText("finalizarCargaSinCarga") || "No hay una carga activa.");
                return;
            }

            if (iEscaneados === 0) {
                sap.m.MessageBox.warning(
                    oBundle.getText("finalizarCargaSinLotes") || "No hay lotes escaneados para finalizar.",
                    { title: oBundle.getText("finalizarCargaTitulo") || "Finalizar Carga" }
                );
                return;
            }

            oView.byId("idPluginPanel").setBusy(true);

            const sParams = {
                plant: oPODParams.PLANT_ID,
                workCenter: oPODParams.WORK_CENTER
            };

            // Traer custom values actuales
            this.getWorkCenterCustomValues(sParams, oSapApi).then(oCurrentRes => {
                const oData = Array.isArray(oCurrentRes) ? oCurrentRes[0] : oCurrentRes;
                if (!oData) {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos") || "Error al obtener datos");
                    return;
                }

                const aCurrentCV = oData.customValues || [];
                const aEdited = [
                    { attribute: "SLOTQTY", value: iEscaneados.toString() }
                ];

                const aEditMap = {};
                aEdited.forEach(item => {
                    aEditMap[item.attribute] = item.value;
                });

                const aCustomValuesFinal = aCurrentCV.map(item => ({
                    attribute: item.attribute,
                    value: aEditMap.hasOwnProperty(item.attribute) ? aEditMap[item.attribute] : item.value
                }));

                for (const key in aEditMap) {
                    if (!aCustomValuesFinal.find(i => i.attribute === key)) {
                        aCustomValuesFinal.push({ attribute: key, value: aEditMap[key] });
                    }
                }

                this.setCustomValuesPp({
                    inCustomValues: aCustomValuesFinal,
                    inPlant: oPODParams.PLANT_ID,
                    inWorkCenter: oPODParams.WORK_CENTER
                }, oSapApi).then(() => {
                    oView.byId("idPluginPanel").setBusy(false);

                    // Actualizar UI
                    oView.byId("slotQty").setValue(iEscaneados.toString());
                    this._updateProgressIndicator();

                    sap.m.MessageBox.success(
                        oBundle.getText("finalizarCargaMensaje", [sNoCarga, iEscaneados, iSlotQty]) ||
                        `Carga #${sNoCarga} finalizada.\nEscaneados: ${iEscaneados}/${iSlotQty}`,
                        { title: oBundle.getText("finalizarCargaTitulo") || "Finalizar Carga" }
                    );

                    setTimeout(() => {
                        this.onGetCustomValues();
                    }, 500);
                }).catch(() => {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorFinalizarCarga") || "Error al finalizar carga");
                });
            }).catch(() => {
                oView.byId("idPluginPanel").setBusy(false);
                sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos") || "Error al obtener datos");
            });
        },
        onBarcodeSubmit: function () {
            const oView = this.getView();
            const oInput = oView.byId("scanInput");
            const sBarcode = oInput.getValue().trim();
            const oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            if (!sBarcode) {
                return; // no hacer nada si está vacío
            }

            const oTable = oView.byId("idSlotTable");
            const oModel = oTable.getModel();
            const aItems = oModel.getProperty("/ITEMS") || [];

            //comparacion del lote ingresado 
            const sNormalizado = sBarcode.toUpperCase();
            //busca si es igual a uno de los items 
            const oExiste = aItems.find(Item => {
                return (Item.value || "").toString().trim().toUpperCase() === sNormalizado;
            });

            //LOGICA DE VALIDACION-------------------------------------------------------

            const partsBarcode = sNormalizado.split('!');

            if (partsBarcode.length < 2 || !partsBarcode[0] || !partsBarcode[1]) {
                sap.m.MessageToast.show(oBundle.getText("batchNotExists"));
                oInput.setValue(""); oInput.focus();
                return;
            }
            const loteExtraido = partsBarcode[1].trim();
            const materialExtraido = partsBarcode[0].trim();

            this._validarMaterialYLote(loteExtraido, materialExtraido);

        },
        /**
        * Funcion del boton "clear" con fragmento de confirmacion para limpiar la tabla y actualizar los customValues  
        * @returns {string} - funcion clearModel
        */
        onPressClear: function () {
            const oView = this.getView(),
                oResBun = oView.getModel("i18n").getResourceBundle();
            this.Commons.showConfirmDialog(function () {
                this.clearModel();
            }.bind(this), null, oResBun.getText("clearWarningMessage"));
        },
        clearModel: function () {
            const oView = this.getView();
            const oTable = oView.byId("idSlotTable");
            const oScanInput = oView.byId("scanInput");
            const oModel = oTable.getModel();
            const oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            const oBundle = this.getView().getModel("i18n").getResourceBundle();

            //obtener el modelo actual de la tabla 
            const aItems = oModel.getProperty("/ITEMS") || [];
            console.log("ITEMS DEL MODELO ACTUAL:", aItems)
            if (aItems.length === 0) {
                sap.m.MessageToast.show(oBundle.getText("noDataToClear"));
                return;
            }
            //vaciar los valores manteniendo el attributo
            aItems.forEach(item => {
                item.value = "";  //se vacia solo el valor 
            });

            //se actualiza el modelo de la vista
            oModel.setProperty("/ITEMS", aItems);
            oModel.refresh(true);
            oScanInput.setValue("");
            oScanInput.focus();

            //se prepara los datos para hacer el update 
            const slotTipo = oView.byId("slotType").getValue();
            const slotQty = oView.byId("slotQty").getValue();
            const noCarga = oView.byId("noCarga").getValue();

            const aEdited = [
                { attribute: "SLOTTIPO", value: slotTipo },
                { attribute: "SLOTQTY", value: 0 },
                { attribute: "NO_CARGA", value: 0 },
                ...aItems.map(slot => ({ attribute: slot.attribute, value: slot.value }))
            ]

            // Llama a la API para obtener los originales
            // const oSapApi = this.Commons.getSapApiPath(this);
            const oSapApi = this.getPublicApiRestDataSourceUri();
            const sParams = {
                plant: oPODParams.PLANT_ID,
                workCenter: oPODParams.WORK_CENTER
            };
            //llamado a la API y traer los originales 
            this.getWorkCenterCustomValues(sParams, oSapApi).then(oOriginalRes => {
                const aOriginal = oOriginalRes.customValues || [];
                const aEditMap = {};

                //se crea el mapa de los valores editados (los vacioos)
                aEdited.forEach(item => {
                    aEditMap[item.attribute] = item.value;  //-----------------------------------------------------------------------------
                })
                //combinar los originales con los editados
                const aCustomValuesFinal = aOriginal.map(item => ({
                    attribute: item.attribute,
                    value: aEditMap.hasOwnProperty(item.attribute) ? aEditMap[item.attribute] : item.value
                }));
                // Agregar los que no estaban en el original, los nuevos en este caso los vacios 
                for (const key in aEditMap) {
                    if (!aCustomValuesFinal.find(i => i.attribute === key)) {
                        aCustomValuesFinal.push({ attribute: key, value: aEditMap[key] });
                    }
                }
                //llamar al pp para actualizar los customValues de WC
                console.log(aCustomValuesFinal);
                this.setCustomValuesPp({
                    inCustomValues: aCustomValuesFinal,
                    inPlant: oPODParams.PLANT_ID,
                    inWorkCenter: oPODParams.WORK_CENTER
                }, oSapApi).then(() => {
                    sap.m.MessageToast.show(oBundle.getText("dataClearedSuccess"));

                    // Esperar 500ms y recargar datos desde API
                    setTimeout(() => {
                        this.onGetCustomValues();
                    }, 500);
                }).catch(() => {
                    sap.m.MessageToast.show(oBundle.getText("errorClearing"));
                    // En caso de error, recargar los datos originales
                    this.onGetCustomValues();
                });
            }).catch(() => {
                sap.m.MessageToast.show("Error al obtener datos originales");
            });

        },
        /**
        * Llamada al Pp(getReservas) para obtener los lotes en Reserva y hacer validacion de material
        * @param {string} sLote - Valor del lote "material!lote" 
        * @param {string} sMaterial - Valor del material "material!lote" 
        * @returns {string} - Solo el material
        */
        _validarMaterialYLote: function (sLote, sMaterial) {
            const oView = this.getView();
            const oBundle = this.getView().getModel("i18n").getResourceBundle();
            const mandante = this.getConfiguration().mandante;
            const oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            const oInput = oView.byId("scanInput");
            const loteEscaneado = sLote;
            const materialEscaneado = sMaterial;

            const sCurrentStatus = this._getCurrentOperationStatus();
            if (sCurrentStatus !== OPERATION_STATUS.ACTIVE) {
                sap.m.MessageBox.error(oBundle.getText("verificarStatusOperacion"))
                return;
            }

            // validacion de material PRIMERO SE HACE LA DEL MATERIAL
            const urlMaterial = this.getPublicApiRestDataSourceUri() + this.ApiPaths.validateMaterialEnOrden;
            var inParamsMaterial = {
                "inPlanta": oPODParams.PLANT_ID,
                "inLote": loteEscaneado,
                "inOrden": oPODParams.ORDER_ID,
                "inMaterial": materialEscaneado
            };
            oView.byId("idPluginPanel").setBusy(true);

            this.ajaxPostRequest(urlMaterial, inParamsMaterial,
                // SUCCESS callback de validación de material
                function (oResMat) {
                    console.log("Respuesta material:", oResMat);
                    const matOk = oResMat && (oResMat.outMaterial === true || oResMat.outMaterial === "true");
                    const msgMat = (oResMat && oResMat.outMensaje) || oBundle.getText("materialNoValido");

                    if (!matOk) {
                        oView.byId("idPluginPanel").setBusy(false);
                        sap.m.MessageToast.show(msgMat);
                        oInput.setValue("");
                        oInput.focus();
                        this._slotContext = null;
                        return;
                    }

                    //Validacion de lotes  DESPUES DE LA DEL MATERIAL
                    var urlLote = this.getPublicApiRestDataSourceUri() + this.ApiPaths.getReservas;
                    var inParamsLote = {
                        "inPlanta": oPODParams.PLANT_ID,
                        "inLote": loteEscaneado,
                        "inOrden": oPODParams.ORDER_ID,
                        "inSapClient": mandante,
                        "inMaterial": materialEscaneado,
                        "inPuesto": oPODParams.WORK_CENTER
                    };

                    this.ajaxPostRequest(urlLote, inParamsLote,
                        // SUCCESS callback de validación de lote
                        function (oResponseData) {
                            oView.byId("idPluginPanel").setBusy(false);
                            console.log("Respuesta lote:", oResponseData);

                            var bEsValido = false;
                            if (oResponseData.outLote === "true" || oResponseData.outLote === true) {
                                bEsValido = true;
                            } else if (oResponseData.outLote === "false" || oResponseData.outLote === false) {
                                bEsValido = false;
                            }

                            if (bEsValido) {
                                // Detectar de dónde vino el escaneo
                                if (!this._slotContext) {
                                    // Viene del input superior → buscar slot vacío
                                    this._ejecutarUpdate();
                                } else {
                                    // Viene del botón por fila → actualizar ese slot
                                    this._procesarSlotValidado();
                                }
                            } else {
                                sap.m.MessageToast.show(oBundle.getText("loteNoValido"));
                                // Solo limpiar input si viene del input superior
                                if (!this._slotContext) {
                                    oInput.setValue("");
                                    oInput.focus();
                                }
                                // Limpiar contexto siempre
                                this._slotContext = null;
                            }
                        }.bind(this),
                        // ERROR callback de validación de lote
                        function (oError, sHttpErrorMessage) {
                            oView.byId("idPluginPanel").setBusy(false);
                            var err = oError || sHttpErrorMessage;
                            sap.m.MessageToast.show("Error al validar lote " + err);

                            // Solo limpiar input si viene del input superior
                            if (!this._slotContext) {
                                oInput.setValue("");
                                oInput.focus();
                            }
                            // Limpiar contexto siempre
                            this._slotContext = null;
                        }.bind(this)
                    );
                }.bind(this),
                // ERROR callback de validación de material
                function (oError, sHttpErrorMessage) {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorValidacion") || ("Error validación material: " + (sHttpErrorMessage || "")));
                    // Solo limpiar input si viene del input superior
                    if (!this._slotContext) {
                        oInput.setValue("");
                        oInput.focus();
                    }
                    // Limpiar contexto siempre
                    this._slotContext = null;
                }.bind(this)
            );
        },
        _ejecutarUpdate: function () {
            const oView = this.getView();
            const oInput = oView.byId("scanInput");
            const sBarcode = oInput.getValue().trim();
            const oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            const oBundle = oView.getModel("i18n").getResourceBundle();

            const oTable = oView.byId("idSlotTable");
            const oModel = oTable.getModel();
            const aItems = oModel.getProperty("/ITEMS") || [];

            // Extraer material!lote del barcode escaneado (ignorar secuencia si existe)
            const sNormalizado = sBarcode.toUpperCase();
            const partsEscaneado = sNormalizado.split('!');
            const materialLoteEscaneado = partsEscaneado.slice(0, 2).join('!'); // solo material!lote

            // Buscar si ya existe un item con el mismo material!lote
            const oExiste = aItems.find(Item => {
                const valorItem = (Item.value || "").toString().trim().toUpperCase();
                if (!valorItem) return false;
                
                const partsItem = valorItem.split('!');
                const materialLoteItem = partsItem.slice(0, 2).join('!'); // solo material!lote
                
                return materialLoteItem === materialLoteEscaneado;
            });

            if (oExiste) {
                sap.m.MessageToast.show(oBundle.getText("barcodeExists", [sBarcode, oExiste.attribute]))
                oInput.setValue("");
                oInput.focus();
                return;
            }

            // Buscar el primer slot vacío
            const oEmptySlot = aItems.find(item => !item.value || item.value === "");

            if (oEmptySlot) {
                // Obtener noCarga del input y concatenar al barcode
                const sNoCarga = oView.byId("noCarga").getValue() || "";
                const sBarcodeConSecuencia = sNoCarga ? sBarcode + "!" + sNoCarga : sBarcode;

                oEmptySlot.value = sBarcodeConSecuencia; // asignar valor con secuencia
                oModel.refresh(true);        // refrescar la tabla
                this._updateProgressIndicator(); // actualizar indicador de progreso
            } else {
                sap.m.MessageToast.show(oBundle.getText("sinLotes"));
                return;
                // sap.m.MessageToast.show("No hay lotes por llenar");
            }

            // Limpiar input y darle foco de nuevo
            oInput.setValue("");
            oInput.focus();

            const slotTipo = oView.byId("slotType").getValue();
            const slotQty = oView.byId("slotQty").getValue();

            // editados
            const aEdited = [
                { attribute: "SLOTTIPO", value: slotTipo },
                { attribute: "SLOTQTY", value: slotQty },
                ...aItems.map(slot => ({ attribute: slot.attribute, value: slot.value }))
            ];

            // const oSapApi = this.Commons.getSapApiPath(this);
            const oSapApi = this.getPublicApiRestDataSourceUri();
            const sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            // trae los customValues originales
            this.getWorkCenterCustomValues(sParams, oSapApi).then(oOriginalRes => {
                const aOriginal = oOriginalRes.customValues || [];

                // combina los custom originales + editados
                const editedMap = {};
                aEdited.forEach(item => { editedMap[item.attribute] = item.value; });

                const aCustomValuesFinal = aOriginal.map(item => ({
                    attribute: item.attribute,
                    value: editedMap.hasOwnProperty(item.attribute) ? editedMap[item.attribute] : item.value
                }));

                // Agregar los que no estaban en el original
                for (const key in editedMap) {
                    if (!aCustomValuesFinal.find(i => i.attribute === key)) {
                        aCustomValuesFinal.push({ attribute: key, value: editedMap[key] });
                    }
                }
                console.log("Custom Values Final:", aCustomValuesFinal);
                // Update inmediato
                this.setCustomValuesPp({
                    inCustomValues: aCustomValuesFinal,
                    inPlant: oPODParams.PLANT_ID,
                    inWorkCenter: oPODParams.WORK_CENTER
                }, oSapApi).then(() => {
                    sap.m.MessageToast.show(oBundle.getText("slotActualizado"));

                    // Verificar si la carga está completa
                    this._checkCargaCompleta();

                    // sap.m.MessageToast.show("Slot actualizado correctamente");
                }).catch(() => {
                    sap.m.MessageToast.show(oBundle.getText("errorActualizarSlot"));
                    // sap.m.MessageBox.error("Error al actualizar los slots");
                });
            });
        },
        onScanSuccess: function (oEvent) {
            if (oEvent.getParameter("cancelled")) {
                sap.m.MessageToast.show("Scan cancelled", { duration: 1000 });
            } else {
                if (oEvent.getParameter("text")) {
                    this.oScanInput.setValue(oEvent.getParameter("text"));
                    this.onBarcodeSubmit();
                } else {
                    this.oScanInput.setValue('');
                }
            }
        },
        onScanError: function (oEvent) {
            sap.m.MessageToast.show("Scan failed: " + oEvent, { duration: 1000 });
        },
        onScanLiveupdate: function (oEvent) {
            // User can implement the validation about inputting value
        },
        //funcion del boton #Eliminar-delete elimina un elemento de la 
        onDeleteSlot: function (oEvent) {
            const oView = this.getView();
            const oTable = this.byId("idSlotTable");
            const oModel = oTable.getModel();
            const oPODParams = this.Commons.getPODParams(this.getOwnerComponent());
            let aSlots = oModel.getProperty("/ITEMS");
            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            // Ubica el índice de la fila seleccionada
            const oItem = oEvent.getSource().getParent(); // el <ColumnListItem>
            const iIndex = oTable.indexOfItem(oItem);

            if (iIndex === -1) {
                return;
            }

            // Elimina el valor de ese slot y recorrer los siguientes hacia arriba
            for (let i = iIndex; i < aSlots.length - 1; i++) {
                aSlots[i].value = aSlots[i + 1].value; // mover valor del siguiente
            }

            // Vacia el último slot
            aSlots[aSlots.length - 1].value = "";

            // Actualiza el modelo
            oModel.setProperty("/ITEMS", aSlots);
            oModel.refresh(true);
            this._updateProgressIndicator(); // actualizar indicador de progreso

            sap.m.MessageToast.show(oBundle.getText("loteEliminado"));
            // sap.m.MessageToast.show("Lote eliminado correctamente");

            // parte del update inmediato
            const slotTipo = oView.byId("slotType").getValue();
            const slotQty = oView.byId("slotQty").getValue();

            const aEdited = [
                { attribute: "SLOTTIPO", value: slotTipo },
                { attribute: "SLOTQTY", value: slotQty },
                ...aSlots.map(slot => ({ attribute: slot.attribute, value: slot.value }))
            ];

            // const oSapApi = this.Commons.getSapApiPath(this);
            const oSapApi = this.getPublicApiRestDataSourceUri();
            const sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            this.getWorkCenterCustomValues(sParams, oSapApi).then(oOriginalRes => {
                const aOriginal = oOriginalRes.customValues || [];
                const editedMap = {};
                aEdited.forEach(item => { editedMap[item.attribute] = item.value; });

                const aCustomValuesFinal = aOriginal.map(item => ({
                    attribute: item.attribute,
                    value: editedMap.hasOwnProperty(item.attribute) ? editedMap[item.attribute] : item.value
                }));

                // agrega los que no estaban en el original
                for (const key in editedMap) {
                    if (!aCustomValuesFinal.find(i => i.attribute === key)) {
                        aCustomValuesFinal.push({ attribute: key, value: editedMap[key] });
                    }
                }

                // Enviar a la API
                this.setCustomValuesPp({
                    inCustomValues: aCustomValuesFinal,
                    inPlant: oPODParams.PLANT_ID,
                    inWorkCenter: oPODParams.WORK_CENTER
                }, oSapApi).then(() => {
                    sap.m.MessageToast.show(oBundle.getText("loteActualizadoAntesEliminar"));
                    // sap.m.MessageToast.show("Lotes actualizados después de eliminar.");
                }).catch(() => {
                    sap.m.MessageBox.error("Error al actualizar tras eliminar");
                });
            });
        },
        //
        onScanSlotSuccess: function (oEvent) {
            const oBundle = this.getView().getModel("i18n").getResourceBundle();

            if (oEvent.getParameter("cancelled")) {
                sap.m.MessageToast.show("Scan cancelled", { duration: 1000 });
                return;
            }
            const sBarcode = (oEvent.getParameter("text") || "").trim();
            if (!sBarcode) { return; }

            const parts = sBarcode.toUpperCase().split('!');
            if (parts.length < 2 || !parts[0] || !parts[1]) {
                sap.m.MessageToast.show(oBundle.getText("batchNotExists"));
                return;
            }

            const sMaterial = parts[0].trim();
            const sLote = parts[1].trim();

            // Guarda contexto para actualizar la fila cuando ambas validaciones pasen
            this._slotContext = { oEvent, sBarcode, loteExtraido: sLote };

            // Reutiliza la validación combinada
            this._validarMaterialYLote(sLote, sMaterial);
        },
        /**
         * Validar lote para slot específico
         */
        _procesarSlotValidado: function () {
            if (!this._slotContext) {
                console.error("No hay contexto de slot guardado");
                return;
            }

            const { oEvent, sBarcode, loteExtraido } = this._slotContext;
            const oBundle = this.getView().getModel("i18n").getResourceBundle();
            const oPODParams = this.Commons.getPODParams(this.getOwnerComponent());

            // se obtiene la fila donde se encuentra el botón
            const oButton = oEvent.getSource();
            const oItem = oButton.getParent(); // el <ColumnListItem>

            // obtiene el índice de la fila
            const oTable = this.byId("idSlotTable");
            const iIndex = oTable.indexOfItem(oItem);

            // obtiene el modelo de la tabla
            const oModel = oTable.getModel();
            const aSlots = oModel.getProperty("/ITEMS");
            //por si no encuentra el índice o el lote
            if (iIndex === -1 || !aSlots[iIndex]) {
                return;
            }

            //comparacion del lote ingresado 
            const sNormalizado = sBarcode.toUpperCase();
            
            // Extraer material!lote del barcode escaneado (ignorar secuencia si existe)
            const partsEscaneado = sNormalizado.split('!');
            const materialLoteEscaneado = partsEscaneado.slice(0, 2).join('!'); // solo material!lote

            //busca si es igual a uno de los items
            const sExiste = aSlots.find((slot, idx) => {
                if (idx === iIndex) {
                    return false; // ignora el slot actual
                }
                const valorSlot = (slot.value || "").toString().trim().toUpperCase();
                if (!valorSlot) return false;
                
                const partsSlot = valorSlot.split('!');
                const materialLoteSlot = partsSlot.slice(0, 2).join('!'); // solo material!lote
                
                return materialLoteSlot === materialLoteEscaneado;
            });

            if (sExiste) {
                sap.m.MessageToast.show(oBundle.getText("barcodeExists", [sBarcode, sExiste.attribute]));
                this._slotContext = null;
                return;
            }
            
            // Si el valor ya es el mismo en esa fila, no actualizar
            const valorActual = (aSlots[iIndex].value || "").toString().trim().toUpperCase();
            if (valorActual) {
                const partsActual = valorActual.split('!');
                const materialLoteActual = partsActual.slice(0, 2).join('!');
                
                if (materialLoteActual === materialLoteEscaneado) {
                    sap.m.MessageToast.show(oBundle.getText("sinCambios"));
                    this._slotContext = null;
                    return;
                }
            }

            // Obtener noCarga del input y concatenar al barcode
            const oView = this.getView();
            const sNoCarga = oView.byId("noCarga").getValue() || "";
            const sBarcodeConSecuencia = sNoCarga ? sBarcode + "!" + sNoCarga : sBarcode;

            // asigna el código escaneado con secuencia al slot correspondiente
            aSlots[iIndex].value = sBarcodeConSecuencia;
            oModel.setProperty("/ITEMS", aSlots);
            oModel.refresh(true);
            this._updateProgressIndicator(); // actualizar indicador de progreso

            // Inputs
            const slotTipo = oView.byId("slotType").getValue();
            const slotQty = oView.byId("slotQty").getValue();

            // Editados
            const aEdited = [
                { attribute: "SLOTTIPO", value: slotTipo },
                { attribute: "SLOTQTY", value: slotQty },
                ...aSlots.map(slot => ({ attribute: slot.attribute, value: slot.value }))
            ];

            // const oSapApi = this.Commons.getSapApiPath(this);
            const oSapApi = this.getPublicApiRestDataSourceUri();
            const sParams = { plant: oPODParams.PLANT_ID, workCenter: oPODParams.WORK_CENTER };

            // Traer originales y combinar
            this.getWorkCenterCustomValues(sParams, oSapApi).then(oOriginalRes => {
                const aOriginal = oOriginalRes.customValues || [];
                const editedMap = {};
                aEdited.forEach(item => { editedMap[item.attribute] = item.value; });

                const aCustomValuesFinal = aOriginal.map(item => ({
                    attribute: item.attribute,
                    value: editedMap.hasOwnProperty(item.attribute) ? editedMap[item.attribute] : item.value
                }));

                for (const key in editedMap) {
                    if (!aCustomValuesFinal.find(i => i.attribute === key)) {
                        aCustomValuesFinal.push({ attribute: key, value: editedMap[key] });
                    }
                }
                console.log(aCustomValuesFinal);
                this.setCustomValuesPp({
                    inCustomValues: aCustomValuesFinal,
                    inPlant: oPODParams.PLANT_ID,
                    inWorkCenter: oPODParams.WORK_CENTER
                }, oSapApi).then(() => {
                    sap.m.MessageToast.show(oBundle.getText("slotActualizado"));
                    this._slotContext = null;

                    // Verificar si la carga está completa
                    this._checkCargaCompleta();
                }).catch(() => {
                    sap.m.MessageToast.show(oBundle.getText("errorActualizar"));
                    this._slotContext = null;
                });
            });

        },

        onBeforeRenderingPlugin: function () {
            var oPodSelectionModel = this.getPodSelectionModel();
            if (oPodSelectionModel && oPodSelectionModel.selectedPhaseData) {
                var sStatus = oPodSelectionModel.selectedPhaseData.status || "";
                gOperationPhase = {
                    status: sStatus
                };
            }

            this.subscribe("phaseSelectionEvent", this.onPhaseSelectionEventCustom, this);

        },
        onPhaseSelectionEventCustom: function (sChannelId, sEventId, oData) {
            if (this.isEventFiredByThisPlugin(oData)) {
                return;
            }
            gOperationPhase = oData;
            this.onGetCustomValues();
            this.onGetOrderCustomValues();
        },

        isSubscribingToNotifications: function () {

            var bNotificationsEnabled = true;

            return bNotificationsEnabled;
        },


        getCustomNotificationEvents: function (sTopic) {
            //return ["template"];
        },


        getNotificationMessageHandler: function (sTopic) {

            //if (sTopic === "template") {
            //    return this._handleNotificationMessage;
            //}
            return null;
        },

        _handleNotificationMessage: function (oMsg) {

            var sMessage = "Message not found in payload 'message' property";
            if (oMsg && oMsg.parameters && oMsg.parameters.length > 0) {
                for (var i = 0; i < oMsg.parameters.length; i++) {

                    switch (oMsg.parameters[i].name) {
                        case "template":

                            break;
                        case "template2":


                    }



                }
            }

        },
        getWorkCenterCustomValues: function (sParams, oSapApi) {
            return new Promise((resolve) => {
                this.ajaxGetRequest(oSapApi + this.ApiPaths.WORKCENTERS, sParams, function (oRes) {
                    const oData = Array.isArray(oRes) ? oRes[0] : oRes;
                    resolve(oData);
                }.bind(this),
                    function (oRes) {
                        // Error callback
                        resolve("Error");
                    }.bind(this));
            });
        },
        setCustomValuesPp: function (oParams, oSapApi) {
            return new Promise((resolve) => {
                this.ajaxPostRequest(oSapApi + this.ApiPaths.putBatchSlotWorkCenter, oParams, function (oRes) {
                    resolve(oRes);
                }.bind(this),
                    function (oRes) {
                        // Error callback
                        resolve("Error");
                    }.bind(this));
            });
        },
        /**
         * Iniciar nueva carga: Incrementar NOCARGA, crear SLOTQTY_CARGA{n}, actualizar UI
         * @param {number} iCantidad - Cantidad de lotes a escanear en esta carga
         */
        _iniciarNuevaCarga: function (iCantidad) {
            const oView = this.getView(),
                oBundle = oView.getModel("i18n").getResourceBundle(),
                oPODParams = this.Commons.getPODParams(this.getOwnerComponent()),
                oSapApi = this.getPublicApiRestDataSourceUri();

            oView.byId("idPluginPanel").setBusy(true);

            const sParams = {
                plant: oPODParams.PLANT_ID,
                workCenter: oPODParams.WORK_CENTER
            };

            // Traer custom values actuales
            this.getWorkCenterCustomValues(sParams, oSapApi).then(oCurrentRes => {
                const oData = Array.isArray(oCurrentRes) ? oCurrentRes[0] : oCurrentRes;
                if (!oData) {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos") || "Error al obtener datos");
                    return;
                }
                const aCurrentCV = oData.customValues || [];
                let iNoCargaActual = 0;

                // Buscar NO_CARGA actual (si no viene, asumir 0)
                const oNoCargaCV = aCurrentCV.find(cv => cv.attribute === "NO_CARGA");
                if (oNoCargaCV) {
                    iNoCargaActual = parseInt(oNoCargaCV.value || "0", 10);
                    if (Number.isNaN(iNoCargaActual)) {
                        iNoCargaActual = 0;
                    }
                }

                // Incrementar NO_CARGA
                const iNuevaCarga = iNoCargaActual + 1;

                // Editados: actualizar NO_CARGA y SLOTQTY con la cantidad ingresada
                const aEdited = [
                    { attribute: "NO_CARGA", value: iNuevaCarga.toString() },
                    { attribute: "SLOTQTY", value: iCantidad.toString() }
                ];

                // Combinar originales + editados
                const aEditMap = {};
                aEdited.forEach(item => {
                    aEditMap[item.attribute] = item.value;
                });

                const aCustomValuesFinal = aCurrentCV.map(item => ({
                    attribute: item.attribute,
                    value: aEditMap.hasOwnProperty(item.attribute) ? aEditMap[item.attribute] : item.value
                }));

                // Agregar nuevos atributos si no existían
                for (const key in aEditMap) {
                    if (!aCustomValuesFinal.find(i => i.attribute === key)) {
                        aCustomValuesFinal.push({ attribute: key, value: aEditMap[key] });
                    }
                }

                console.log("CVs finales para nueva carga:", aCustomValuesFinal);

                // Llamar a API para actualizar
                this.setCustomValuesPp({
                    inCustomValues: aCustomValuesFinal,
                    inPlant: oPODParams.PLANT_ID,
                    inWorkCenter: oPODParams.WORK_CENTER
                }, oSapApi).then(() => {
                    oView.byId("idPluginPanel").setBusy(false);

                    // Actualizar UI
                    oView.byId("noCarga").setValue(iNuevaCarga.toString());
                    oView.byId("slotQty").setValue(iCantidad.toString());

                    // Guardar estado de carga actual en memoria
                    this._cargaActual = {
                        noCarga: iNuevaCarga,
                        cantidad: iCantidad,
                        escaneados: 0
                    };

                    sap.m.MessageToast.show(oBundle.getText("cargaInitSuccess") || ("Carga " + iNuevaCarga + " iniciada. Cantidad: " + iCantidad));

                    // Esperar 500ms para que el backend procese completamente antes de recargar
                    setTimeout(() => {
                        this.onGetCustomValues();
                    }, 500);

                }).catch(() => {
                    oView.byId("idPluginPanel").setBusy(false);
                    sap.m.MessageToast.show(oBundle.getText("errorInitCarga") || "Error al iniciar carga");
                });
            }).catch(() => {
                oView.byId("idPluginPanel").setBusy(false);
                sap.m.MessageToast.show(oBundle.getText("errorObtenerDatos") || "Error al obtener datos");
            });
        },


        /**
         * Actualizar indicador de progreso (contador y barra)
         */
        _updateProgressIndicator: function () {
            const oView = this.getView();
            const oTable = oView.byId("idSlotTable");
            const oModel = oTable.getModel();
            const aItems = oModel ? oModel.getProperty("/ITEMS") : [];
            const iSlotQty = parseInt(oView.byId("slotQty").getValue() || "0", 10);

            // Contar slots escaneados (con valor)
            const iEscaneados = aItems.filter(slot => slot.value && slot.value.trim() !== "").length;

            // Actualizar texto del contador
            const oProgressCounter = oView.byId("progressCounter");
            if (oProgressCounter) {
                oProgressCounter.setText(iEscaneados + "/" + iSlotQty);
            }

            // Actualizar barra de progreso
            const oProgressBar = oView.byId("progressBar");
            if (oProgressBar && iSlotQty > 0) {
                const iPercent = Math.round((iEscaneados / iSlotQty) * 100);
                oProgressBar.setPercentValue(iPercent);
                oProgressBar.setDisplayValue(iPercent + "%");

                // Cambiar color según progreso
                if (iEscaneados === 0) {
                    oProgressBar.setState("None");
                } else if (iEscaneados < iSlotQty) {
                    oProgressBar.setState("Warning");
                } else if (iEscaneados === iSlotQty) {
                    oProgressBar.setState("Success");
                }
            } else if (oProgressBar) {
                oProgressBar.setPercentValue(0);
                oProgressBar.setDisplayValue("0%");
                oProgressBar.setState("None");
            }
        },

        /**
         * Verificar si la carga está completa y mostrar mensaje de éxito
         */
        _checkCargaCompleta: function () {
            const oView = this.getView();
            const oTable = oView.byId("idSlotTable");
            const oModel = oTable.getModel();
            const aItems = oModel ? oModel.getProperty("/ITEMS") : [];
            const iSlotQty = parseInt(oView.byId("slotQty").getValue() || "0", 10);
            const sNoCarga = oView.byId("noCarga").getValue() || "0";
            const oBundle = oView.getModel("i18n").getResourceBundle();

            // Contar slots escaneados
            const iEscaneados = aItems.filter(slot => slot.value && slot.value.trim() !== "").length;

            // Si la carga está completa, mostrar mensaje de éxito
            if (iSlotQty > 0 && iEscaneados === iSlotQty) {
                sap.m.MessageBox.success(
                    oBundle.getText("cargaCompletadaMensaje", [sNoCarga, iEscaneados, iSlotQty]) ||
                    `Carga #${sNoCarga} completada exitosamente.\n${iEscaneados}/${iSlotQty} lotes escaneados.`,
                    {
                        title: oBundle.getText("cargaCompletadaTitulo") || "¡Carga Completa!"
                    }
                );
            }
        },

        /**
         * Verificar si la cantidad sugerida para la orden está completa
         */
        onGetOrderCustomValues: function () {
            const oView = this.getView();
            const oPODParams = this.Commons.getPODParams(this.getOwnerComponent());

            var requestJSON = {
                "plant": oPODParams.PLANT_ID,
                "order": oPODParams.ORDER_ID
            };

            var url = this.getPublicApiRestDataSourceUri() + this.ApiPaths.CHARACHTERISTICS;
            this.ajaxGetRequest(url, requestJSON,
                function (oResponseData) {
                    // Extraer el customValue con atributo CT_100035_500 (número de solera)
                    if (oResponseData && Array.isArray(oResponseData)) {
                        const oCustomValue = oResponseData.find(cv => cv.attribute === "CT_100035_500");
                        const sSuggestedQty = oCustomValue ? oCustomValue.value : "0";
                        oView.byId("slotQtySuggest").setValue(sSuggestedQty);
                    }
                },
                function (oError, sHttpErrorMessage) {
                    var err = oError || sHttpErrorMessage;
                    sap.m.MessageToast.show(err);
                }
            );
        },

        onExit: function () {
            PluginViewController.prototype.onExit.apply(this, arguments);
            this.unsubscribe("phaseSelectionEvent", this.onPhaseSelectionEventCustom, this);

        }
    });
});