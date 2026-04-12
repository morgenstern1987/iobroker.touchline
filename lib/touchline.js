const axios=require("axios");

class Touchline{

    constructor(ip){
        this.ip=ip;
    }

    async getZones(){

        const res=await axios.get(
            "http://"+this.ip+"/status.json"
        );

        if(!res.data.zones){
            return [];
        }

        return res.data.zones.map(z=>({
            id:z.id,
            name:z.name,
            temperature:z.temperature,
            setpoint:z.setpoint
        }));

    }

    async setTemp(zone,temp){

        await axios.get(
            "http://"+this.ip+
            "/set?zone="+zone+
            "&temp="+temp
        );

    }

}

module.exports=Touchline;
